import { buildRecommendationProfile } from '@/data/recommendationProfile';
import type { Game } from '@/types';

export const INTERNAL_WIKI_COMPILE_VERSION = '2026-05-14.structured-wiki';

type InternalWikiMode = 'referee' | 'recommendation';
type InternalWikiCompleteness = 'rich' | 'partial' | 'minimal';

const INTERNAL_STOPWORDS = new Set([
  '这个',
  '那个',
  '一下',
  '规则',
  '问题',
  '判定',
  '可以',
  '不能',
  '什么',
  '怎么',
]);

export interface InternalRecommendationIntent {
  requestedPlayerCount?: number;
  requestedPlayerRangeMin?: number;
  requestedPlayerRangeMax?: number;
  maxPlaytime?: number;
  minPlaytime?: number;
  maxAgeRating?: number;
  maxComplexity?: number;
  minComplexity?: number;
  desiredTags: string[];
  searchTerms: string[];
}

export interface InternalWikiCitation {
  label: string;
  chunkId: string;
  gameId?: string;
  title: string;
  sectionTitle?: string;
  snippet: string;
  fullText: string;
}

interface InternalWikiChapter {
  chapterId: string;
  chapterTitle: string;
  chapterRank: number;
  text: string;
  keywords: string[];
  sourceFields: string[];
}

interface InternalWikiBundle {
  mode: InternalWikiMode;
  gameId: string;
  gameTitle: string;
  compileVersion: string;
  completeness: InternalWikiCompleteness;
  confidence: number;
  missingFields: string[];
  conflictFlags: string[];
  chapters: InternalWikiChapter[];
}

interface InternalWikiContextPack {
  contextText: string;
  citations: InternalWikiCitation[];
  bundle: InternalWikiBundle;
}

function compactText(value?: string): string {
  return (value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeCompact(value?: string): string {
  return compactText(value)
    .toLowerCase()
    .replace(/[*_`#>\-\[\](){}|:：,.，。！？!?/\\]/g, '')
    .replace(/\s+/g, '');
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(
    values
      .map((value) => compactText(value || ''))
      .filter(Boolean),
  ));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extractKeywords(text: string, extra: string[] = []): string[] {
  const tokens = compactText(text).match(/[\u4e00-\u9fa5]{2,6}|[a-z0-9+]{2,16}/gi) ?? [];
  const normalizedTokens = tokens
    .map((token) => compactText(token).toLowerCase())
    .filter((token) => token.length >= 2 && !INTERNAL_STOPWORDS.has(token));

  return uniqueStrings([...extra, ...normalizedTokens]).slice(0, 18);
}

function splitLongBlock(block: string, maxLength: number): string[] {
  const compact = compactText(block);
  if (!compact) {
    return [];
  }

  if (compact.length <= maxLength) {
    return [compact];
  }

  const sentences = compact
    .split(/(?<=[。！？；;])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    const chunks: string[] = [];
    for (let cursor = 0; cursor < compact.length; cursor += maxLength) {
      chunks.push(compact.slice(cursor, cursor + maxLength).trim());
    }
    return chunks.filter(Boolean);
  }

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current + sentence).length <= maxLength) {
      current = `${current}${sentence}`;
      continue;
    }
    chunks.push(current.trim());
    current = sentence;
  }
  if (current) {
    chunks.push(current.trim());
  }
  return chunks.filter(Boolean);
}

function splitRuleBlocks(text?: string, maxLength: number = 260): string[] {
  const compact = compactText(text);
  if (!compact) {
    return [];
  }

  const qaBlocks = Array.from(
    compact.matchAll(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?Q[:：][\s\S]*?(?=\n\s*[-*]?\s*(?:\*\*)?Q[:：]|\n#{1,6}\s|$)/gi),
  )
    .map((match) => compactText(match[0]))
    .filter(Boolean);

  const rawBlocks = qaBlocks.length > 0
    ? qaBlocks
    : compact
      .split(/\n{2,}|(?=\n#{1,6}\s)/)
      .map((block) => compactText(block))
      .filter(Boolean);

  return rawBlocks.flatMap((block) => splitLongBlock(block, maxLength));
}

function createChapter(
  chapterId: string,
  chapterTitle: string,
  chapterRank: number,
  text: string,
  sourceFields: string[],
  extraKeywords: string[] = [],
): InternalWikiChapter {
  return {
    chapterId,
    chapterTitle,
    chapterRank,
    text: compactText(text),
    keywords: extractKeywords(`${chapterTitle}\n${text}`, extraKeywords),
    sourceFields,
  };
}

function resolveRuleCompleteness(game: Game, chapterCount: number): InternalWikiCompleteness {
  if (game.knowledgeTier === 'catalog') {
    return chapterCount >= 2 ? 'partial' : 'minimal';
  }
  if (chapterCount >= 6) {
    return 'rich';
  }
  if (chapterCount >= 3) {
    return 'partial';
  }
  return 'minimal';
}

function resolveRecommendationCompleteness(game: Game, chapterCount: number): InternalWikiCompleteness {
  if (!game.oneLiner || game.tags.length === 0) {
    return chapterCount >= 3 ? 'partial' : 'minimal';
  }
  return chapterCount >= 6 ? 'rich' : 'partial';
}

function buildConflictFlags(game: Game): string[] {
  const flags: string[] = [];

  if (game.minPlayers > game.maxPlayers) {
    flags.push('player_range_invalid');
  }
  if ((game.bestPlayerCount ?? []).some((count) => count < game.minPlayers || count > game.maxPlayers)) {
    flags.push('best_player_count_out_of_range');
  }
  if (game.playtimeMin <= 0) {
    flags.push('playtime_invalid');
  }
  if (game.knowledgeTier === 'catalog') {
    flags.push('catalog_only_rule_coverage');
  }

  return flags;
}

function summarizeRuleCoverage(game: Game): { missingFields: string[]; confidence: number } {
  const missingFields: string[] = [];

  if (!compactText(game.rules?.target)) {
    missingFields.push('rules.target');
  }
  if (!compactText(game.rules?.flow)) {
    missingFields.push('rules.flow');
  }
  if (!compactText(game.rules?.tips)) {
    missingFields.push('rules.tips');
  }
  if (!compactText(game.FAQ)) {
    missingFields.push('FAQ');
  }
  if (!compactText(game.knowledgeBase)) {
    missingFields.push('knowledgeBase');
  }

  let confidence = 0.42 + (5 - missingFields.length) * 0.11;
  if (game.knowledgeTier === 'catalog') {
    confidence -= 0.18;
  }

  return {
    missingFields,
    confidence: clamp(confidence, 0.18, 0.96),
  };
}

function summarizeRecommendationCoverage(game: Game, chapterCount: number): { missingFields: string[]; confidence: number } {
  const missingFields: string[] = [];
  if (!compactText(game.oneLiner)) {
    missingFields.push('oneLiner');
  }
  if (game.tags.length === 0) {
    missingFields.push('tags');
  }
  if (!game.bestPlayerCount?.length) {
    missingFields.push('bestPlayerCount');
  }
  if (!compactText(game.knowledgeBase)) {
    missingFields.push('knowledgeBase');
  }

  const confidence = clamp(0.48 + chapterCount * 0.06 - missingFields.length * 0.05, 0.25, 0.94);
  return { missingFields, confidence };
}

function buildTeachabilityText(game: Game): string {
  if (game.complexity <= 1.4) {
    return '上手门槛偏低，适合快速开局和临场教学。';
  }
  if (game.complexity <= 2.5) {
    return '教学量适中，建议开局前先讲目标、回合流程和关键限制。';
  }
  return '教学成本偏高，更适合愿意先听完整规则、再进入正式对局的玩家。';
}

function buildAvoidIfText(game: Game): string {
  const cautions: string[] = [];

  if (game.maxPlayers <= 4) {
    cautions.push('不适合临时扩成大团体局');
  }
  if (game.playtimeMin >= 60) {
    cautions.push('不适合只想快速热场的场景');
  }
  if (game.complexity >= 2.8) {
    cautions.push('不适合第一次接触桌游、又不想花时间听规则的玩家');
  }
  if (cautions.length === 0) {
    cautions.push('整体适配面比较广，只要人数和时长对得上就能考虑');
  }

  return cautions.join('；');
}

function buildRecommendationSummary(game: Game): string {
  const bestCount = game.bestPlayerCount?.length
    ? `最佳人数通常是 ${game.bestPlayerCount.join(' / ')} 人`
    : '';

  return uniqueStrings([
    game.oneLiner,
    `支持 ${game.minPlayers}-${game.maxPlayers} 人`,
    bestCount,
    `常规时长约 ${game.playtimeMin} 分钟`,
  ]).join('；');
}

function compileRefereeWiki(game: Game): InternalWikiBundle {
  const chapters: InternalWikiChapter[] = [];
  const ruleCoverage = summarizeRuleCoverage(game);

  if (compactText(game.rules?.target)) {
    chapters.push(createChapter(
      'win_condition',
      '胜利与终局',
      1,
      game.rules.target,
      ['rules.target'],
      ['获胜', '胜利', '终局', '分数', '结束'],
    ));
  }

  if (compactText(game.rules?.flow)) {
    chapters.push(createChapter(
      'turn_structure',
      '回合流程',
      2,
      game.rules.flow,
      ['rules.flow'],
      ['流程', '步骤', '回合', '行动'],
    ));
  }

  if (compactText(game.rules?.tips)) {
    chapters.push(createChapter(
      'teach_and_tips',
      '教学提醒',
      3,
      game.rules.tips,
      ['rules.tips'],
      ['提醒', '技巧', '新手', '注意'],
    ));
  }

  splitRuleBlocks(game.FAQ, 240).forEach((block, index) => {
    chapters.push(createChapter(
      `faq_resolution_${index + 1}`,
      '常见争议裁定',
      10 + index,
      block,
      ['FAQ'],
      ['faq', '争议', '裁定', '能不能', '是否'],
    ));
  });

  splitRuleBlocks(game.knowledgeBase, 260).forEach((block, index) => {
    chapters.push(createChapter(
      `rule_detail_${index + 1}`,
      '关键规则细节',
      20 + index,
      block,
      ['knowledgeBase'],
      ['关键规则', '限制', '触发', '例外', '结算'],
    ));
  });

  const filteredChapters = chapters.filter((chapter) => compactText(chapter.text));
  const completeness = resolveRuleCompleteness(game, filteredChapters.length);

  return {
    mode: 'referee',
    gameId: game.id,
    gameTitle: game.titleCn,
    compileVersion: INTERNAL_WIKI_COMPILE_VERSION,
    completeness,
    confidence: ruleCoverage.confidence,
    missingFields: ruleCoverage.missingFields,
    conflictFlags: buildConflictFlags(game),
    chapters: filteredChapters,
  };
}

function compileRecommendationWiki(game: Game): InternalWikiBundle {
  const profile = game.recommendationProfile ?? buildRecommendationProfile(game);
  const chapters: InternalWikiChapter[] = [];

  chapters.push(createChapter(
    'fit_summary',
    '总体适配摘要',
    1,
    buildRecommendationSummary(game),
    ['oneLiner', 'bestPlayerCount', 'playtimeMin'],
    [game.titleCn, game.titleEn],
  ));

  chapters.push(createChapter(
    'player_fit',
    '人数适配',
    2,
    uniqueStrings([
      `支持 ${game.minPlayers}-${game.maxPlayers} 人`,
      game.bestPlayerCount?.length ? `最佳人数通常是 ${game.bestPlayerCount.join(' / ')} 人` : '',
      profile.playerTags.length ? `相关词条：${profile.playerTags.join(' / ')}` : '',
    ]).join('；'),
    ['minPlayers', 'maxPlayers', 'bestPlayerCount', 'recommendationProfile.playerTags'],
    [...profile.playerTags, '人数', '组局'],
  ));

  chapters.push(createChapter(
    'time_fit',
    '时长与节奏',
    3,
    uniqueStrings([
      `常规时长约 ${game.playtimeMin} 分钟`,
      profile.durationTags.length ? `节奏词条：${profile.durationTags.join(' / ')}` : '',
    ]).join('；'),
    ['playtimeMin', 'recommendationProfile.durationTags'],
    [...profile.durationTags, '时长', '节奏'],
  ));

  chapters.push(createChapter(
    'mood_fit',
    '氛围与互动',
    4,
    uniqueStrings([
      profile.occasionTags.length ? `场景更贴合：${profile.occasionTags.join(' / ')}` : '',
      profile.interactionTags.length ? `互动体验：${profile.interactionTags.join(' / ')}` : '',
      profile.moodTags.length ? `整体氛围：${profile.moodTags.join(' / ')}` : '',
    ]).join('；'),
    ['recommendationProfile.occasionTags', 'recommendationProfile.interactionTags', 'recommendationProfile.moodTags'],
    [...profile.occasionTags, ...profile.interactionTags, ...profile.moodTags],
  ));

  chapters.push(createChapter(
    'mechanic_fit',
    '机制与主题',
    5,
    uniqueStrings([
      profile.mechanicTags.length ? `核心机制：${profile.mechanicTags.join(' / ')}` : '',
      profile.themeTags.length ? `主题倾向：${profile.themeTags.join(' / ')}` : '',
      game.tags.length ? `展示标签：${game.tags.join(' / ')}` : '',
    ]).join('；'),
    ['recommendationProfile.mechanicTags', 'recommendationProfile.themeTags', 'tags'],
    [...profile.mechanicTags, ...profile.themeTags, ...game.tags],
  ));

  chapters.push(createChapter(
    'teachability',
    '教学成本',
    6,
    buildTeachabilityText(game),
    ['complexity'],
    ['教学', '上手', '复杂度'],
  ));

  chapters.push(createChapter(
    'avoid_if',
    '不优先推荐的情况',
    7,
    buildAvoidIfText(game),
    ['complexity', 'playtimeMin', 'maxPlayers'],
    ['不适合', '避坑', '不要', '限制'],
  ));

  chapters.push(createChapter(
    'search_aliases',
    '检索别名',
    8,
    uniqueStrings([
      `标准标签：${profile.allTags.join(' / ')}`,
      `扩展搜索词：${profile.searchTerms.join(' / ')}`,
    ]).join('；'),
    ['recommendationProfile.allTags', 'recommendationProfile.searchTerms'],
    [...profile.allTags, ...profile.searchTerms],
  ));

  const filteredChapters = chapters.filter((chapter) => compactText(chapter.text));
  const completeness = resolveRecommendationCompleteness(game, filteredChapters.length);
  const recommendationCoverage = summarizeRecommendationCoverage(game, filteredChapters.length);

  return {
    mode: 'recommendation',
    gameId: game.id,
    gameTitle: game.titleCn,
    compileVersion: INTERNAL_WIKI_COMPILE_VERSION,
    completeness,
    confidence: recommendationCoverage.confidence,
    missingFields: recommendationCoverage.missingFields,
    conflictFlags: buildConflictFlags(game),
    chapters: filteredChapters,
  };
}

function scoreRefereeChapter(chapter: InternalWikiChapter, userQuestion: string): number {
  const normalizedQuestion = normalizeCompact(userQuestion);
  const questionKeywords = extractKeywords(userQuestion);
  const chapterTitle = normalizeCompact(chapter.chapterTitle);
  const chapterText = normalizeCompact(chapter.text);
  let score = Math.max(0, 30 - chapter.chapterRank);

  for (const keyword of questionKeywords) {
    const normalizedKeyword = normalizeCompact(keyword);
    if (!normalizedKeyword) {
      continue;
    }
    if (chapterTitle.includes(normalizedKeyword)) {
      score += 6;
    }
    if (chapter.keywords.some((value) => normalizeCompact(value).includes(normalizedKeyword))) {
      score += 4;
    }
    if (chapterText.includes(normalizedKeyword)) {
      score += 2;
    }
  }

  if (chapterText.includes(normalizedQuestion)) {
    score += 8;
  }
  if (/(赢|获胜|胜利|终局|结束|计分|分数)/.test(userQuestion) && chapter.chapterId === 'win_condition') {
    score += 8;
  }
  if (/(流程|步骤|回合|怎么玩|怎么进行)/.test(userQuestion) && chapter.chapterId === 'turn_structure') {
    score += 8;
  }
  if (/(能不能|可以吗|允许|必须|是否|什么时候)/.test(userQuestion) && /^faq_resolution_/.test(chapter.chapterId)) {
    score += 6;
  }
  if (/(能不能|可以吗|允许|必须|是否|什么时候)/.test(userQuestion) && /^rule_detail_/.test(chapter.chapterId)) {
    score += 5;
  }
  if (/(能不能|可以吗|允许|必须|是否|什么时候)/.test(userQuestion) && chapter.chapterId === 'teach_and_tips') {
    score -= 5;
  }

  return score;
}

function selectRefereeChapters(bundle: InternalWikiBundle, userQuestion: string, limit: number = 4): InternalWikiChapter[] {
  const ranked = [...bundle.chapters]
    .map((chapter) => ({
      chapter,
      score: scoreRefereeChapter(chapter, userQuestion),
    }))
    .sort((left, right) => right.score - left.score || left.chapter.chapterRank - right.chapter.chapterRank);

  const positiveScoreChapters = ranked.filter((entry) => entry.score > 0).map((entry) => entry.chapter);
  if (positiveScoreChapters.length > 0) {
    return positiveScoreChapters.slice(0, limit);
  }

  return ranked.slice(0, limit).map((entry) => entry.chapter);
}

function buildInternalCitation(game: Game, chapter: InternalWikiChapter, index: number): InternalWikiCitation {
  return {
    label: `资料${index + 1}`,
    chunkId: `internal:${game.id}:${chapter.chapterId}`,
    gameId: game.id,
    title: game.titleCn,
    sectionTitle: chapter.chapterTitle,
    snippet: compactText(chapter.text).slice(0, 120),
    fullText: chapter.text,
  };
}

export function buildInternalRefereeContext(game: Game, userQuestion: string): InternalWikiContextPack {
  const bundle = compileRefereeWiki(game);
  const selectedChapters = selectRefereeChapters(bundle, userQuestion, 4);
  const citations = selectedChapters.map((chapter, index) => buildInternalCitation(game, chapter, index));

  const contextText = [
    `游戏：${game.titleCn}`,
    `内部规则编译版本：${bundle.compileVersion}`,
    `知识完整度：${bundle.completeness}`,
    bundle.conflictFlags.length > 0 ? `需要留意：${bundle.conflictFlags.join(' / ')}` : '',
    '请只依据下列内部规则章节作答，不要向用户暴露章节名、编译信息或资料来源。',
    ...selectedChapters.map((chapter) => [
      `[内部章节] ${chapter.chapterTitle}`,
      chapter.text,
    ].join('\n')),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    contextText,
    citations,
    bundle,
  };
}

function buildIntentTerms(intent: InternalRecommendationIntent): string[] {
  const terms = [...intent.desiredTags, ...intent.searchTerms];

  if (typeof intent.requestedPlayerCount === 'number') {
    terms.push(`${intent.requestedPlayerCount}人`, '人数');
  }
  if (
    typeof intent.requestedPlayerRangeMin === 'number' &&
    typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    terms.push(`${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax}人`, '人数');
  }
  if (typeof intent.maxPlaytime === 'number') {
    terms.push(`${intent.maxPlaytime}分钟内`, '时长');
  }
  if (typeof intent.minPlaytime === 'number') {
    terms.push(`${intent.minPlaytime}分钟以上`, '时长');
  }
  if (typeof intent.maxAgeRating === 'number') {
    terms.push(`${intent.maxAgeRating}岁可玩`, '年龄门槛');
  }
  if (typeof intent.maxComplexity === 'number') {
    terms.push(`复杂度不高于${intent.maxComplexity}`, '低复杂度');
  }
  if (typeof intent.minComplexity === 'number') {
    terms.push(`复杂度不低于${intent.minComplexity}`, '策略深度');
  }

  return uniqueStrings(terms);
}

function scoreRecommendationChapter(chapter: InternalWikiChapter, intentTerms: string[]): number {
  let score = Math.max(0, 30 - chapter.chapterRank);
  const chapterTitle = normalizeCompact(chapter.chapterTitle);
  const chapterText = normalizeCompact(chapter.text);

  for (const term of intentTerms) {
    const normalizedTerm = normalizeCompact(term);
    if (!normalizedTerm) {
      continue;
    }
    if (chapterTitle.includes(normalizedTerm)) {
      score += 6;
    }
    if (chapter.keywords.some((keyword) => normalizeCompact(keyword).includes(normalizedTerm))) {
      score += 4;
    }
    if (chapterText.includes(normalizedTerm)) {
      score += 2;
    }
  }

  if (chapter.chapterId === 'fit_summary') {
    score += 6;
  }
  if (intentTerms.some((term) => /人/.test(term)) && chapter.chapterId === 'player_fit') {
    score += 7;
  }
  if (intentTerms.some((term) => /分钟|时长|节奏/.test(term)) && chapter.chapterId === 'time_fit') {
    score += 7;
  }
  if (intentTerms.some((term) => /聚会|破冰|亲子|情侣|合作|推理|策略|轻松|烧脑/.test(term)) && chapter.chapterId === 'mood_fit') {
    score += 5;
  }

  return score;
}

function selectRecommendationChapters(
  bundle: InternalWikiBundle,
  intent: InternalRecommendationIntent,
  limit: number = 4,
): InternalWikiChapter[] {
  const intentTerms = buildIntentTerms(intent);
  if (intentTerms.length === 0) {
    return bundle.chapters.slice(0, limit);
  }

  return [...bundle.chapters]
    .map((chapter) => ({
      chapter,
      score: scoreRecommendationChapter(chapter, intentTerms),
    }))
    .sort((left, right) => right.score - left.score || left.chapter.chapterRank - right.chapter.chapterRank)
    .slice(0, limit)
    .map((entry) => entry.chapter);
}

function buildIntentHeader(intent: InternalRecommendationIntent): string {
  if (
    typeof intent.requestedPlayerRangeMin === 'number' &&
    typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    return `用户希望找到 ${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax} 人都能成立的游戏。`;
  }
  if (typeof intent.requestedPlayerCount === 'number') {
    return `用户当前主要在找 ${intent.requestedPlayerCount} 人局能玩的游戏。`;
  }
  return '用户当前在找一款更贴合当下场景的游戏。';
}

export function buildInternalRecommendationContext(
  games: Game[],
  intent: InternalRecommendationIntent,
): string {
  if (games.length === 0) {
    return '';
  }

  const intentTerms = buildIntentTerms(intent);
  const blocks = games.slice(0, 5).map((game, index) => {
    const bundle = compileRecommendationWiki(game);
    const chapters = selectRecommendationChapters(bundle, intent, 4);

    return [
      `内部候选 ${index + 1}`,
      `game_id=${game.id}`,
      `game_name=${game.titleCn}`,
      `compile_version=${bundle.compileVersion}`,
      `fit_confidence=${bundle.confidence.toFixed(2)}`,
      ...chapters.map((chapter) => `- ${chapter.chapterTitle}：${chapter.text}`),
    ].join('\n');
  });

  return [
    buildIntentHeader(intent),
    intentTerms.length > 0 ? `本轮重点词条：${intentTerms.join(' / ')}` : '',
    '以下内容是内部整理后的候选摘要。你只能把它当作回答依据，不能把内部字段名、章节名、置信度或编译信息暴露给用户。',
    ...blocks,
  ]
    .filter(Boolean)
    .join('\n\n');
}
