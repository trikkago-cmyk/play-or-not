// LLM 服务 - 支持多种API提供商
import { GAME_DATABASE } from '@/data/gameDatabase';
import { buildRagEvidencePack, queryKnowledgeBase, type RagCitation, type RagHit } from './pythonRagService';
import type { Game, ChatMode } from '@/types';

// API 配置
interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: string;
}

const LLM_CONFIG_KEY = 'llm_app_config_v2';
const CURRENT_USER_QUESTION_MARKER = '[用户的当前提问]:';

// 预设的API提供商
const API_PROVIDERS: Record<string, { baseUrl: string; model: string }> = {
  volcengine: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
  },
};

// 当前配置
let currentConfig: LLMConfig | null = {
  apiKey: '',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'deepseek-v3-1-terminus',
  provider: 'volcengine',
};
let useMockMode = false;

// 设置API配置
export function setLLMConfig(apiKey: string, provider: string = 'volcengine') {
  const providerConfig = API_PROVIDERS[provider];
  if (!providerConfig) {
    // 允许自定义 provider 字符串作为 fallback，或者抛出错误
    // 这里为了灵活性，如果找不到预设，假设用户想用 openai 格式但自定义了 baseUrl? 
    // 暂时保持原样，抛错更安全
    if (provider.startsWith('http')) {
      // Support custom URL passed as provider? Maybe later.
    }
    throw new Error(`不支持的API提供商: ${provider}`);
  }
  currentConfig = {
    apiKey,
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
  };
  useMockMode = false;
}

// 设置模拟模式
export function setMockMode(enabled: boolean) {
  useMockMode = enabled;
}

// 获取是否使用模拟模式
export function isMockMode(): boolean {
  return useMockMode;
}

interface PromptContext {
  mode: ChatMode;
  activeGame?: Game;
  retrievedRulesContext?: string;
  retrievedRuleCitations?: RagCitation[];
  recommendationContext?: string;
  excludedRecommendationNames?: string[];
}

interface RecommendationCandidate {
  game: Game;
  aggregateScore: number;
  matchedSections: string[];
  snippets: string[];
}

interface RecommendationIntent {
  requestedPlayerCount?: number;
  requestedPlayerRangeMin?: number;
  requestedPlayerRangeMax?: number;
  maxPlaytime?: number;
  desiredTags: string[];
  searchTerms: string[];
}

const SMALLTALK_ONLY_PATTERN = /^(你好|您好|嗨|哈喽|hello|hi|thanks|thankyou|谢谢|谢啦|多谢|好的|好滴|ok|okay|收到|明白|拜拜|再见|哈哈|hhh|嗯嗯|嗯|哦哦)[!！,.。?？~～]*$/i;
const REFEREE_CONTROL_QUERY_PATTERN = /(换个游戏|换别的游戏|不玩这个了|退出裁判|回到推荐|切回推荐|推荐别的|换个模式)/;
const RECOMMENDATION_META_QUERY_PATTERN = /^(你是谁|你能做什么|你会什么|怎么玩|这个应用是干嘛的|这个产品是干嘛的)[!！,.。?？~～]*$/;

function extractCurrentUserQuestion(rawInput: string): string {
  const markerIndex = rawInput.lastIndexOf(CURRENT_USER_QUESTION_MARKER);
  if (markerIndex === -1) {
    return rawInput.trim();
  }

  return rawInput.slice(markerIndex + CURRENT_USER_QUESTION_MARKER.length).trim();
}

function parseRequestedPlayerCount(query: string): number | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const numericMatch = trimmed.match(/(\d+)\s*(?:人|个人)/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1], 10);
  }

  const cnNumberMap: Record<string, number> = {
    '两': 2,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
  };
  const cnMatch = trimmed.match(/([两二三四五六七八九十])\s*(?:人|个人)/);
  return cnMatch ? cnNumberMap[cnMatch[1]] : undefined;
}

function parseRequestedPlayerRange(query: string): { min?: number; max?: number } {
  const trimmed = query.trim();
  if (!trimmed) {
    return {};
  }

  const numericRangeMatch = trimmed.match(/(\d+)\s*[-~到至]\s*(\d+)\s*(?:人|个人)/);
  if (numericRangeMatch) {
    const min = Number.parseInt(numericRangeMatch[1], 10);
    const max = Number.parseInt(numericRangeMatch[2], 10);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }
  }

  const cnNumberMap: Record<string, number> = {
    '两': 2,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
  };
  const cnRangeMatch = trimmed.match(/([两二三四五六七八九十])\s*[到至]\s*([两二三四五六七八九十])\s*(?:人|个人)/);
  if (cnRangeMatch) {
    const min = cnNumberMap[cnRangeMatch[1]];
    const max = cnNumberMap[cnRangeMatch[2]];
    if (min && max) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }
  }

  return {};
}

function parseRequestedMaxPlaytime(query: string): number | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/半小时/.test(trimmed)) {
    return 30;
  }

  if (/一小时/.test(trimmed)) {
    return 60;
  }

  const minuteMatch = trimmed.match(/(\d+)\s*分钟/);
  if (minuteMatch) {
    return Number.parseInt(minuteMatch[1], 10);
  }

  return undefined;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

function normalizeCompactUserInput(text: string): string {
  return text.replace(/\s+/g, '').trim().toLowerCase();
}

function shouldSkipKnowledgeRetrieval(userInput: string, mode: ChatMode): boolean {
  const normalized = normalizeCompactUserInput(userInput);
  if (!normalized) {
    return true;
  }

  if (SMALLTALK_ONLY_PATTERN.test(normalized)) {
    return true;
  }

  if (mode === 'referee') {
    return REFEREE_CONTROL_QUERY_PATTERN.test(normalized);
  }

  if (mode === 'recommendation') {
    return RECOMMENDATION_META_QUERY_PATTERN.test(normalized);
  }

  return false;
}

function getStructuredRecommendationTags(game: Game): string[] {
  return game.recommendationProfile?.allTags ?? game.tags;
}

function getStructuredSearchTerms(game: Game): string[] {
  return game.recommendationProfile?.searchTerms ?? game.tags;
}

function parseRecommendationIntent(query: string): RecommendationIntent {
  const desiredTags: string[] = [];
  const searchTerms: string[] = [];
  const playerRange = parseRequestedPlayerRange(query);

  const addIntent = (tags: string[], terms: string[]) => {
    desiredTags.push(...tags);
    searchTerms.push(...terms);
  };

  if (/情侣|约会/.test(query)) {
    addIntent(['双人核心', '情侣约会'], ['双人', '两人', '情侣', '约会']);
  }
  if (/双人|两人|2人/.test(query)) {
    addIntent(['双人核心'], ['双人', '两人', '2人']);
  }
  if (/聚会|人多|热闹|团建/.test(query)) {
    addIntent(['朋友聚会'], ['聚会', '人多', '热闹', '多人']);
  }
  if (/破冰|聊天|说话|表达/.test(query)) {
    addIntent(['团建破冰', '猜词联想'], ['破冰', '聊天', '说话', '表达']);
  }
  if (/合作|协作|友好/.test(query) || /不想.*互相伤害/.test(query)) {
    addIntent(['合作共赢', '低冲突友好'], ['合作', '不互相伤害', '友好']);
  }
  if (/阵营|身份|推理/.test(query)) {
    addIntent(['阵营推理'], ['阵营', '身份', '推理']);
  }
  if (/嘴炮|谈判/.test(query)) {
    addIntent(['嘴炮谈判'], ['嘴炮', '谈判']);
  }
  if (/对抗|博弈/.test(query)) {
    addIntent(['高互动对抗'], ['对抗', '博弈']);
  }
  if (/策略|烧脑|重策/.test(query)) {
    addIntent(['烧脑策略', '重策略'], ['策略', '烧脑', '重策']);
  }
  if (/轻松|休闲|简单|上手快|新手/.test(query)) {
    addIntent(['轻松休闲', '新手友好'], ['轻松', '休闲', '上手快', '新手']);
  }
  if (/搞笑|欢乐/.test(query)) {
    addIntent(['欢乐搞笑', '朋友聚会'], ['搞笑', '欢乐']);
  }

  const maxPlaytime = parseRequestedMaxPlaytime(query);
  if (typeof maxPlaytime === 'number') {
    if (maxPlaytime <= 15) {
      addIntent(['15分钟内'], ['15分钟内', '十几分钟']);
    } else if (maxPlaytime <= 30) {
      addIntent(['30分钟内'], ['30分钟内', '半小时内', '半小时']);
    } else if (maxPlaytime <= 60) {
      addIntent(['60分钟内'], ['60分钟内', '一小时内']);
    }
  }

  if (typeof playerRange.min === 'number' && typeof playerRange.max === 'number') {
    searchTerms.push(`${playerRange.min}到${playerRange.max}人`, `${playerRange.min}-${playerRange.max}人`);

    if (playerRange.min <= 2) {
      addIntent(['双人核心'], ['双人', '两人', '2人']);
    }
    if (playerRange.max >= 3 && playerRange.min <= 4) {
      addIntent(['3到4人佳'], ['3到4人', '3-4人', '四人']);
    }
    if (playerRange.max >= 5) {
      addIntent(['5人以上佳'], ['多人', '5人以上']);
    }
    if (playerRange.max >= 7) {
      addIntent(['大团体适配'], ['大团体', '团建']);
    }
  } else {
    const requestedPlayerCount = parseRequestedPlayerCount(query);
    if (requestedPlayerCount === 2) {
      addIntent(['双人核心'], ['双人', '两人', '2人']);
    } else if (requestedPlayerCount && requestedPlayerCount >= 3 && requestedPlayerCount <= 4) {
      addIntent(['3到4人佳'], [`${requestedPlayerCount}人`, '3到4人', '3-4人']);
    } else if (requestedPlayerCount && requestedPlayerCount >= 5) {
      addIntent(['5人以上佳'], [`${requestedPlayerCount}人`, '多人', '5人以上']);
      if (requestedPlayerCount >= 7) {
        addIntent(['大团体适配'], ['大团体', '团建']);
      }
    }
  }

  return {
    requestedPlayerCount:
      typeof playerRange.min === 'number' && typeof playerRange.max === 'number'
        ? undefined
        : parseRequestedPlayerCount(query),
    requestedPlayerRangeMin: playerRange.min,
    requestedPlayerRangeMax: playerRange.max,
    maxPlaytime,
    desiredTags: uniqueStrings(desiredTags),
    searchTerms: uniqueStrings(searchTerms),
  };
}

function buildRecommendationWhere(intent: RecommendationIntent): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [{ mode: 'recommendation' }];

  if (
    typeof intent.requestedPlayerRangeMin === 'number' &&
    typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    filters.push({ min_players: { $lte: intent.requestedPlayerRangeMin } });
    filters.push({ max_players: { $gte: intent.requestedPlayerRangeMax } });
  } else if (typeof intent.requestedPlayerCount === 'number') {
    filters.push({ min_players: { $lte: intent.requestedPlayerCount } });
    filters.push({ max_players: { $gte: intent.requestedPlayerCount } });
  }

  if (typeof intent.maxPlaytime === 'number') {
    filters.push({ playtime_min: { $lte: intent.maxPlaytime } });
  }

  return filters.length === 1 ? filters[0] : { $and: filters };
}

function buildRecommendationRetrievalQuery(query: string, intent: RecommendationIntent): string {
  const expansions = uniqueStrings([
    ...intent.desiredTags,
    ...intent.searchTerms,
  ]);

  if (expansions.length === 0) {
    return query;
  }

  return `${query}\n\n推荐检索标签：${expansions.join(' / ')}`;
}

function calculateRecommendationBoost(game: Game, intent: RecommendationIntent): number {
  const profileTags = getStructuredRecommendationTags(game);
  let score = 0;

  for (const tag of intent.desiredTags) {
    if (profileTags.includes(tag)) {
      score += 0.4;
    }
  }

  if (
    typeof intent.requestedPlayerRangeMin === 'number' &&
    typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    const supportsFullRange =
      game.minPlayers <= intent.requestedPlayerRangeMin &&
      game.maxPlayers >= intent.requestedPlayerRangeMax;
    const overlapsRequestedRange =
      game.minPlayers <= intent.requestedPlayerRangeMax &&
      game.maxPlayers >= intent.requestedPlayerRangeMin;
    const bestMatchesInRange = (game.bestPlayerCount ?? []).filter(
      (count) => count >= intent.requestedPlayerRangeMin! && count <= intent.requestedPlayerRangeMax!,
    ).length;

    if (supportsFullRange) {
      score += 0.55;
    } else if (overlapsRequestedRange) {
      score += 0.15;
    } else {
      score -= 0.65;
    }

    if (bestMatchesInRange > 0) {
      score += 0.15 + Math.min(0.2, bestMatchesInRange * 0.08);
    }
  } else if (typeof intent.requestedPlayerCount === 'number') {
    if (game.bestPlayerCount?.includes(intent.requestedPlayerCount)) {
      score += 0.5;
    } else if (game.minPlayers <= intent.requestedPlayerCount && game.maxPlayers >= intent.requestedPlayerCount) {
      score += 0.2;
    } else {
      score -= 0.5;
    }
  }

  if (typeof intent.maxPlaytime === 'number') {
    if (game.playtimeMin <= intent.maxPlaytime) {
      score += 0.35;
    } else if (game.playtimeMin <= intent.maxPlaytime + 15) {
      score += 0.1;
    } else {
      score -= 0.35;
    }
  }

  if (intent.desiredTags.includes('重策略') && game.complexity >= 2.8) {
    score += 0.25;
  }
  if (intent.desiredTags.includes('新手友好') && game.complexity <= 1.5) {
    score += 0.25;
  }

  return score;
}

function isGameCompatibleWithIntent(game: Game, intent: RecommendationIntent): boolean {
  if (
    typeof intent.requestedPlayerRangeMin === 'number' &&
    typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    return game.minPlayers <= intent.requestedPlayerRangeMin
      && game.maxPlayers >= intent.requestedPlayerRangeMax;
  }

  const requestedPlayerCount = intent.requestedPlayerCount;
  if (!requestedPlayerCount) {
    return true;
  }

  if (game.bestPlayerCount?.includes(requestedPlayerCount)) {
    return true;
  }

  return game.minPlayers <= requestedPlayerCount && game.maxPlayers >= requestedPlayerCount;
}

function getHitGameId(hit: RagHit): string | undefined {
  const metadataGameId = hit.metadata?.game_id;
  if (typeof metadataGameId === 'string' && metadataGameId.trim()) {
    return metadataGameId.trim();
  }

  return hit.document_id || undefined;
}

function getHitSectionTitle(hit: RagHit): string | undefined {
  const sectionTitleFromMetadata = hit.metadata?.section_title;
  if (typeof sectionTitleFromMetadata === 'string' && sectionTitleFromMetadata.trim()) {
    return sectionTitleFromMetadata.trim();
  }

  return hit.section_title || undefined;
}

function summarizeSnippet(text: string, maxLength: number = 110): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

function buildLocalRecommendationCandidates(
  query: string,
  intent: RecommendationIntent,
  excludeIds: string[] = [],
): RecommendationCandidate[] {
  const normalizedQuery = normalizeCompactUserInput(query);
  const sparseIntent =
    !intent.maxPlaytime &&
    intent.desiredTags.filter((tag) => !['双人核心', '3到4人佳', '5人以上佳', '大团体适配'].includes(tag)).length === 0;

  const candidates = GAME_DATABASE
    .filter((game) => !excludeIds.includes(game.id))
    .filter((game) => isGameCompatibleWithIntent(game, intent))
    .map((game) => {
      const structuredTags = getStructuredRecommendationTags(game);
      const searchTerms = getStructuredSearchTerms(game);

      let aggregateScore = calculateRecommendationBoost(game, intent);

      if (normalizedQuery) {
        const titleSurface = normalizeCompactUserInput(`${game.titleCn} ${game.titleEn}`);
        const tagSurface = normalizeCompactUserInput([...structuredTags, ...searchTerms, ...game.tags].join(' '));

        if (titleSurface.includes(normalizedQuery)) {
          aggregateScore += 0.45;
        }
        if (tagSurface.includes(normalizedQuery)) {
          aggregateScore += 0.25;
        }
      }

      if (game.knowledgeTier !== 'catalog') {
        aggregateScore += 0.08;
      }

      if (sparseIntent) {
        if (structuredTags.includes('手速反应') && !structuredTags.includes('朋友聚会')) {
          aggregateScore -= 0.18;
        }
        if (game.complexity <= 1.1) {
          aggregateScore -= 0.08;
        }
        if (game.complexity >= 1.4 && game.complexity <= 2.8) {
          aggregateScore += 0.12;
        }
      }

      const matchedSections: string[] = [];
      if (typeof intent.requestedPlayerRangeMin === 'number' && typeof intent.requestedPlayerRangeMax === 'number') {
        matchedSections.push('人数范围匹配');
      } else if (typeof intent.requestedPlayerCount === 'number') {
        matchedSections.push('人数匹配');
      }

      return {
        game,
        aggregateScore,
        matchedSections,
        snippets: [game.oneLiner],
      };
    })
    .sort((left, right) => right.aggregateScore - left.aggregateScore);

  return candidates.slice(0, 8);
}

function buildCandidateFallbackReply(
  candidate: RecommendationCandidate,
  correctionReason?: 'out_of_pool',
): string {
  const game = candidate.game;
  const reasons = [
    `人数支持 **${game.minPlayers}-${game.maxPlayers}人**`,
    game.bestPlayerCount?.length
      ? `常见最佳人数是 **${game.bestPlayerCount.join(' / ')}人**`
      : undefined,
    `大致时长 **${game.playtimeMin} 分钟**`,
    game.tags.length > 0 ? `体验关键词：${game.tags.slice(0, 3).join(' / ')}` : undefined,
  ].filter(Boolean);

  const lead = correctionReason === 'out_of_pool'
    ? `按你刚才这句，我先回到当前召回里最稳的一款：**《${game.titleCn}》**。`
    : `我先推荐 **《${game.titleCn}》**。`;

  return [
    lead,
    '',
    game.oneLiner,
    '',
    ...reasons.map((reason) => `- ${reason}`),
  ].join('\n');
}

function buildRecommendationCandidates(
  hits: RagHit[],
  excludeIds: string[] = [],
  intent: RecommendationIntent = { desiredTags: [], searchTerms: [] },
): RecommendationCandidate[] {
  const groupedCandidates = new Map<string, RecommendationCandidate>();

  for (const hit of hits) {
    const gameId = getHitGameId(hit);
    if (!gameId || excludeIds.includes(gameId)) {
      continue;
    }

    const game = GAME_DATABASE.find((item) => item.id === gameId);
    if (!game) {
      continue;
    }

    const closeness = hit.score > 0 ? hit.score : 1 / (1 + Math.max(hit.distance, 0));
    const matchedSection = getHitSectionTitle(hit);
    const existingCandidate = groupedCandidates.get(game.id);

    if (!existingCandidate) {
      groupedCandidates.set(game.id, {
        game,
        aggregateScore:
          closeness +
          calculateRecommendationBoost(game, intent) +
          (
            typeof intent.requestedPlayerCount === 'number' && game.bestPlayerCount?.includes(intent.requestedPlayerCount)
              ? 0.3
              : 0
          ),
        matchedSections: matchedSection ? [matchedSection] : [],
        snippets: [summarizeSnippet(hit.text)],
      });
      continue;
    }

    existingCandidate.aggregateScore += closeness + calculateRecommendationBoost(game, intent) * 0.2;
    if (matchedSection && !existingCandidate.matchedSections.includes(matchedSection)) {
      existingCandidate.matchedSections.push(matchedSection);
    }
    const snippet = summarizeSnippet(hit.text);
    if (snippet && !existingCandidate.snippets.includes(snippet) && existingCandidate.snippets.length < 2) {
      existingCandidate.snippets.push(snippet);
    }
  }

  const candidates = Array.from(groupedCandidates.values()).sort((left, right) => {
    if (
      typeof intent.requestedPlayerRangeMin === 'number' &&
      typeof intent.requestedPlayerRangeMax === 'number'
    ) {
      const leftSupportsFullRange = Number(
        left.game.minPlayers <= intent.requestedPlayerRangeMin &&
        left.game.maxPlayers >= intent.requestedPlayerRangeMax,
      );
      const rightSupportsFullRange = Number(
        right.game.minPlayers <= intent.requestedPlayerRangeMin &&
        right.game.maxPlayers >= intent.requestedPlayerRangeMax,
      );
      if (leftSupportsFullRange !== rightSupportsFullRange) {
        return rightSupportsFullRange - leftSupportsFullRange;
      }
    } else if (intent.requestedPlayerCount) {
      const leftBest = left.game.bestPlayerCount?.includes(intent.requestedPlayerCount) ? 1 : 0;
      const rightBest = right.game.bestPlayerCount?.includes(intent.requestedPlayerCount) ? 1 : 0;
      if (leftBest !== rightBest) {
        return rightBest - leftBest;
      }
    }

    return right.aggregateScore - left.aggregateScore;
  });

  if (!intent.requestedPlayerCount && typeof intent.requestedPlayerRangeMin !== 'number') {
    return candidates;
  }

  const compatibleCandidates = candidates.filter((candidate) => isGameCompatibleWithIntent(candidate.game, intent));

  return compatibleCandidates.length > 0 ? compatibleCandidates : candidates;
}

function formatRecommendationContext(
  candidates: RecommendationCandidate[],
  intent: RecommendationIntent = { desiredTags: [], searchTerms: [] },
): string {
  if (candidates.length === 0) {
    return '';
  }

  const header = typeof intent.requestedPlayerRangeMin === 'number' && typeof intent.requestedPlayerRangeMax === 'number'
    ? `已识别到用户可能想找 **${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax}人都能玩** 的游戏，以下是检索出来的高相关候选游戏。`
    : intent.requestedPlayerCount
      ? `已识别到用户可能想找 **${intent.requestedPlayerCount}人局**，以下是检索出来的高相关候选游戏。`
    : '以下是基于用户当前提问从知识库召回出来的高相关候选游戏。';

  const blocks = candidates.slice(0, 5).map((candidate, index) => {
    const sectionText = candidate.matchedSections.length > 0
      ? candidate.matchedSections.join('、')
      : '综合信息';
    const snippetText = candidate.snippets.join(' / ');
    const structuredTags = getStructuredRecommendationTags(candidate.game).slice(0, 8);

    return [
      `候选${index + 1}：**《${candidate.game.titleCn}》**`,
      `- ID：${candidate.game.id}`,
      `- 人数：${candidate.game.minPlayers}-${candidate.game.maxPlayers}人`,
      `- 结构化词条：${structuredTags.join(' / ')}`,
      `- 展示标签：${candidate.game.tags.join(' / ')}`,
      `- 一句话：${candidate.game.oneLiner}`,
      `- 命中章节：${sectionText}`,
      `- 检索线索：${snippetText}`,
    ].join('\n');
  });

  return [header, ...blocks].join('\n\n');
}

// 构建系统提示词
function getSystemInstruction({
  mode,
  activeGame,
  retrievedRulesContext,
  retrievedRuleCitations = [],
  recommendationContext,
  excludedRecommendationNames = [],
}: PromptContext): string {
  const basePersona = `
    你叫“DM 洛思”。你是一个热情、直率、懂气氛的桌游组局王。
    你的语言风格：口语化、幽默、简短有力。
    绝对不要用机器人的语气，像个懂行的朋友一样聊天。
    回复必须使用简体中文。
    
    【格式要求】：
    - 适当使用 **加粗** 来强调重点（如游戏名、关键规则）。
    - 涉及步骤或多点建议时，请使用 Markdown 列表。
  `;

  // OPTIMIZATION: Only send necessary fields for recommendation to save context
  const databaseSummary = GAME_DATABASE.map(g => ({
    id: g.id,
    name: g.titleCn,
    tags: getStructuredRecommendationTags(g),
    pitch: g.oneLiner,
    players: `${g.minPlayers}-${g.maxPlayers}`,
    bestFor: g.bestPlayerCount ? `${g.bestPlayerCount.join(',')}人最佳` : undefined,
    knowledgeTier: g.knowledgeTier ?? 'full',
  }));

  const databaseContext = `
    目前我们的游戏库里有以下${databaseSummary.length}款游戏（优先推荐这些游戏；如果用户问的是库外游戏或本地库没有合适候选，可以走通用知识回答，但不要伪造本地 recommendation_id）：
    ${JSON.stringify(databaseSummary)}
  `;

  if (mode === 'recommendation') {
    const recommendationContextBlock = recommendationContext?.trim()
      ? `
      【推荐候选池（重要）】：
      以下候选是根据用户当前提问，从知识库中先检索出来的高相关游戏。**优先从这些候选里选**，除非它们明显不符合用户需求。
      ${recommendationContext}
      `
      : '';

    const recommendationAvailabilityBlock = recommendationContext?.trim()
      ? `
      【本地知识库状态】：
      当前已经召回到一批高相关本地候选，优先从这些候选里做推荐。
      `
      : `
      【本地知识库状态】：
      当前没有召回到高置信的本地候选，或者本地库并不覆盖用户正在问的具体游戏。
      这时你可以使用通用桌游知识回答，但必须遵守：
      1. 不要把库外游戏伪装成本地已收录游戏。
      2. 如果回答的是库外游戏或纯通用建议，recommendation_id 必须为 null。
      3. 如果用户明确问的是某一款库外游戏，额外返回 unknown_target_game。
      `;

    const excludedRecommendationBlock = excludedRecommendationNames.length > 0
      ? `
      【本轮不要重复推荐】：
      以下游戏已经推荐过了，这一轮尽量不要再次推荐：
      ${excludedRecommendationNames.join('、')}
      `
      : '';

    return `
      ${basePersona}
      
      【当前模式】：推销员 / 推荐模式
      ${recommendationAvailabilityBlock}
      ${recommendationContextBlock}
      ${excludedRecommendationBlock}
      
      【任务】：
    1. 根据用户的输入（人数、场景、氛围），优先推荐一款最合适的本地库游戏。
    2. 如果【推荐候选池】不为空，**只能**从候选池里选择最合适的一款；不要跳回全库里另选一款“你更熟”的游戏。
    3. 如果本地库没有高质量候选，或者用户明确在问一款库外游戏，你可以使用通用桌游知识回答。
    4. 每次只专注推荐 **1款** 最匹配的游戏；如果你走的是通用知识回答路线，则不要硬塞本地推荐。
    5. 只有在推荐本地库游戏时，才返回 recommendation_id。
    6. 当你已经决定推荐本地库游戏时，**禁止**提及除该推荐游戏以外的其他游戏名称，避免混淆。绝对不要进行对比（例如“像xxx一样”）。
    7. 如果用户说“换一个”，请避开【本轮不要重复推荐】里的游戏。
    8. 如果用户目前只给了很粗的信息（例如只有人数，没有场景、时长、氛围），不要机械地总推同一款万能热场游戏；优先在候选池里挑更贴合的候选，或者简短追问一句。

      【回复格式要求】：
      - 请务必使用 ** Markdown ** 格式。
      - 游戏名必须使用 **书名号《》** 并加粗。例如：**《卡坦岛》**。
    - 推荐理由请使用无序列表（- 理由1...）。
    - 如果有多个要点，请分段显示。

      【兜底策略（重要）】：
      如果用户明确询问或要求推荐一款具体的游戏，且该游戏不在上述我们的游戏库列表中，或者本地候选明显不匹配：
      1. 请主要依赖你自身的知识库储备来详细科普或回答，向玩家介绍该游戏的规则、特色和玩法。
      2. 只有当你的预训练数据中完全没有任何关于这款游戏的记录时，才可以回答不知道，绝对不要凭空捏造。
      3. 在返回的 JSON 中，加入字段 "unknown_target_game": "用户询问的游戏名称"。
      4. 这类回答的 recommendation_id 必须为 null。

      【输出格式规则 - 重要】：
      - 如果你决定推荐一款本地库存在的游戏，返回严格 JSON：
      {
        "thought": "思考过程",
        "reply": "致用户的文本",
        "recommendation_name": "游戏完整中文名",
        "recommendation_id": "该游戏的ID"
      }

      - 如果用户询问了本地库不存在的游戏：
      {
        "thought": "识别到未收录游戏...",
        "reply": "你的回复内容（基于自身知识科普或承认不知道）",
        "recommendation_id": null,
        "unknown_target_game": "用户询问的具体游戏名"
      }

      - 如果只是普通聊天：
      {
        "thought": "思考过程",
        "reply": "回复内容",
        "recommendation_id": null
      }
      
      ${recommendationContext?.trim() ? '' : databaseContext}
    `;
  } else {
    // Referee Mode Logic
    const rulesContext = retrievedRulesContext?.trim()
      ? retrievedRulesContext
      : activeGame?.knowledgeBase
        ? activeGame.knowledgeBase
        : JSON.stringify(activeGame?.rules);
    const hasAuthoritativeRules = Boolean(retrievedRulesContext?.trim() || activeGame?.knowledgeBase?.trim())
      && activeGame?.knowledgeTier !== 'catalog';

    const citationGuide = retrievedRuleCitations.length > 0
      ? `
      【证据标签】：
      你收到的规则资料已经带了证据标签，例如 [证据1]、[证据2]。
      回答时请遵守：
      1. 关键判定、关键例外、胜负结论后，尽量补上对应证据标签，例如“**不能这么做** [证据2]”。
      2. 不要编造不存在的证据标签，只能使用资料里真的出现过的标签。
      3. 如果当前资料没有直接写明，明确说“当前规则资料里没有直接写明”，不要装作规则原文有写。
      `
      : '';

    return `
      ${basePersona}
      
      【当前模式】：裁判模式(当前游戏: ${activeGame?.titleCn} / ${activeGame?.titleEn})
      
      ${hasAuthoritativeRules ? '【核心技能库(Rulebook Skill Set)】：' : '【当前知识覆盖说明】：'}
      ${hasAuthoritativeRules ? ` 
    你已装备《${activeGame?.titleCn}》的规则库检索结果。请优先基于以下资料进行判罚：
    """
      ${rulesContext}
    """
      ${citationGuide}` : `
    这款游戏暂时没有完整的本地规则库，你不能假装“规则原文已经明确写明”。
    你可以基于通用桌游知识和常见版本规则给出谨慎帮助，但必须明确区分：
    1. 哪些是你比较有把握的通用知识；
    2. 哪些只是推断或常见版本做法；
    3. 哪些你并不确定，需要用户再核对实体规则书、官方 FAQ 或教学视频。`}
      
      【任务】：
    1. 当本地规则库完整时，你按 **强规则权威** 回答；当本地规则库不完整时，你按 **谨慎助理** 回答。
    2. 当用户询问规则、争议、流程时，优先检索【核心技能库】。
    3. ** 请直接回答问题 **，不要复述参考资料的原文。不要说“根据规则...”。
    4. 遇到资料未提及的细节，不要假装规则里明确写了；可以给出谨慎推断，但要说清楚是推断。
    5. 解释规则要通俗易懂，像朋友交流一样自然。
      
      【回复格式要求】：
      - 必须使用 ** Markdown ** 格式。
    - 关键规则点、数字、判定结果请 ** 加粗 **。
    - 步骤或多条规则请使用列表（1. / - ）。
    - **禁止** 使用引用块（>）摘抄原文。

    5. 如果用户问“换个游戏玩”或“不玩这个了”，请在 JSON 中设置 switch_to_recommendation 为 true。

      【输出格式规则】：
      返回严格 JSON，无 Markdown：
    {
      "reply": "你的裁判回答（支持 Markdown）",
        "switch_to_recommendation": boolean
    }
    `;
  }
}

function buildCitationReferenceBlock(
  text: string,
  citations: RagCitation[],
): string {
  if (citations.length === 0) {
    return text;
  }

  const supportedLabels = new Set(citations.map((citation) => `[${citation.label}]`));
  const normalizedText = text
    .replace(/\[证据\d+\]/g, (label) => (supportedLabels.has(label) ? label : ''))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？、,.:;])/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const usedLabels = Array.from(new Set((normalizedText.match(/\[证据\d+\]/g) || []).map((label) => label.replace(/[\[\]]/g, ''))));
  const resolvedCitations = (usedLabels.length > 0
    ? citations.filter((citation) => usedLabels.includes(citation.label))
    : citations.slice(0, Math.min(2, citations.length)));

  if (resolvedCitations.length === 0) {
    return normalizedText;
  }

  const referenceLines = resolvedCitations.map((citation) => {
    const heading = citation.sectionTitle
      ? `${citation.title} / ${citation.sectionTitle}`
      : citation.title;
    return `- [${citation.label}] ${heading}：${citation.snippet}`;
  });

  const alreadyHasReferenceBlock = /参考依据|证据来源/.test(normalizedText);
  if (alreadyHasReferenceBlock) {
    return normalizedText;
  }

  return [
    normalizedText,
    '',
    '**参考依据**',
    ...referenceLines,
  ].join('\n');
}

// 调用真实LLM API
async function callLLMAPI(messages: { role: string; content: string }[], mode: ChatMode): Promise<string> {
  if (!currentConfig) {
    throw new Error('LLM未配置');
  }

  try {
    // 根据模式调整 temperature
    const temperature = mode === 'recommendation' ? 0.7 : 0.2;

    // 对于支持 JSON mode 的模型（如 OpenAI），可以在这里添加 response_format: { type: "json_object" }
    // 目前通用的做法是在 prompt 里强调返回 JSON
    const body = {
      model: currentConfig.model,
      messages,
      max_tokens: 1000,
      temperature: temperature,
      // We pass the baseUrl to the proxy so it knows which provider to hit (in case of multiple)
      // The proxy will use its own secure API key
      providerBaseUrl: currentConfig.baseUrl,
      userApiKey: currentConfig.apiKey?.trim() ? currentConfig.apiKey : undefined,
    };

    const response = await fetch(`/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error || `HTTP ${response.status} `;

      if (errorMsg.includes('Balance') || errorMsg.includes('balance')) {
        console.warn('API余额不足，切换到模拟模式');
        useMockMode = true;
      }

      throw new Error(`API错误: ${errorMsg} `);
    }

    const data = await response.json();
    let content = data.choices[0]?.message?.content || '{}';

    // 清理可能存在的 Markdown 标记 (```json ... ```)
    content = content.replace(/```json\n ?|\n ? ```/g, '').trim();

    return content;
  } catch (error) {
    console.error('LLM API调用失败:', error);
    useMockMode = true;
    throw error;
  }
}

// 模拟LLM响应 (Smart Mock / Free AI)
function mockLLMResponse(userInput: string, mode: ChatMode, activeGame?: Game, excludeIds: string[] = []): string {
  if (mode === 'referee') {
    const isSwitchRequest = userInput.includes('换') || userInput.includes('不玩') || userInput.includes('推荐');

    if (!activeGame) {
      return JSON.stringify({
        reply: "请先选择一个游戏来进行裁判。",
        switch_to_recommendation: isSwitchRequest
      });
    }

    if (isSwitchRequest) {
      return JSON.stringify({
        reply: "好的，那我们换个模式或者换个游戏。",
        switch_to_recommendation: true
      });
    }

    // Smart Referee Logic (Offline)
    // 1. Prepare knowledge source
    const rulesJson = JSON.stringify(activeGame.rules);
    const knowledgeSource = (activeGame.knowledgeBase || '') + '\n' + rulesJson + '\n' + (activeGame.FAQ || '');

    // 2. Intent Detection
    const isAskingWinning = userInput.includes('赢') || userInput.includes('胜利') || userInput.includes('目标') || userInput.includes('条件');
    const isAskingFlow = userInput.includes('流程') || userInput.includes('怎么玩') || userInput.includes('步骤') || userInput.includes('回合');
    const isAskingTips = userInput.includes('技巧') || userInput.includes('建议') || userInput.includes('注意');

    // 3. Direct Intent Matching (Highest Priority)
    let reply = "";

    if (isAskingWinning) {
      reply = `**《${activeGame.titleCn}》获胜条件 **：\n\n${activeGame.rules.target} `;
    } else if (isAskingFlow) {
      reply = `**《${activeGame.titleCn}》游戏流程 **：\n\n${activeGame.rules.flow} `;
    } else if (isAskingTips) {
      reply = `**《${activeGame.titleCn}》新手技巧 **：\n\n${activeGame.rules.tips} `;
    } else {
      // 4. Keyword matching as fallback
      const keywords = userInput.toLowerCase().split(/[\s,，?？!！]+/).filter(k => k.length > 1);
      let matchedLines: string[] = [];

      if (knowledgeSource && keywords.length > 0) {
        const lines = knowledgeSource.split('\n').filter(l => l.trim().length > 5);
        lines.forEach(line => {
          let score = 0;
          keywords.forEach(kw => {
            if (line.toLowerCase().includes(kw)) score++;
          });
          if (score > 0) {
            matchedLines.push(line.trim());
          }
        });
      }

      if (matchedLines.length > 0) {
        const uniqueMatches = Array.from(new Set(matchedLines)).slice(0, 4);
        reply = `关于"${userInput}"，我找到了以下相关规则：\n\n` + uniqueMatches.map(l => `• ${l} `).join('\n');
      } else {
        // Default helpful response
        reply = `关于《${activeGame.titleCn}》，我来帮你解答：\n\n` +
          `** 目标 **：${activeGame.rules.target} \n\n` +
          `如果是具体的规则细节，你可以试着问我：\n• 怎么算赢？\n• 游戏流程是什么？\n• 有什么技巧？`;
      }
    }

    return JSON.stringify({
      reply: reply,
      switch_to_recommendation: false
    });
  }

  // Smart Mock Recommendation Logic
  // 1. Keyword Extraction & Semantic Mapping (Basic)
  const keywords = userInput.toLowerCase();
  let matchedGames: Game[] = [];
  let thoughtProcess = "分析用户输入关键词...";

  // Simple keyword matching rules
  // Extract player count from input (e.g. "3个人", "5人", "两人")
  const playerCountMatch = keywords.match(/(\d+)\s*[个人]/);
  const cnNumberMap: Record<string, number> = { '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8 };
  const cnMatch = keywords.match(/([两二三四五六七八])\s*[个人]/);
  const requestedCount = playerCountMatch ? parseInt(playerCountMatch[1]) :
    cnMatch ? cnNumberMap[cnMatch[1]] || 0 : 0;

  if (requestedCount > 0) {
    // Prioritize games with bestPlayerCount matching, then fall back to range
    const bestMatches = GAME_DATABASE.filter(g => g.bestPlayerCount?.includes(requestedCount));
    const rangeMatches = GAME_DATABASE.filter(g => !g.bestPlayerCount?.includes(requestedCount) && g.minPlayers <= requestedCount && g.maxPlayers >= requestedCount);
    matchedGames = [...bestMatches, ...rangeMatches];
  } else if (keywords.includes('聚会') || keywords.includes('人多') || keywords.includes('热闹')) {
    matchedGames = GAME_DATABASE.filter(g => getStructuredRecommendationTags(g).includes('朋友聚会') || g.maxPlayers >= 6 || (g.bestPlayerCount && g.bestPlayerCount.some(n => n >= 5)));
  } else if (keywords.includes('两人') || keywords.includes('情侣') || keywords.includes('2人')) {
    matchedGames = GAME_DATABASE.filter(g => getStructuredRecommendationTags(g).includes('双人核心') || g.bestPlayerCount?.includes(2) || g.maxPlayers === 2);
  } else if (keywords.includes('策略') || keywords.includes('烧脑')) {
    matchedGames = GAME_DATABASE.filter(g => g.complexity >= 2.0);
  } else if (keywords.includes('简单') || keywords.includes('新手')) {
    matchedGames = GAME_DATABASE.filter(g => g.complexity <= 1.5);
  } else if (keywords.includes('合作')) {
    matchedGames = GAME_DATABASE.filter(g => getStructuredRecommendationTags(g).includes('合作共赢'));
  } else {
    // Fuzzy search by title or description
    matchedGames = GAME_DATABASE.filter(g =>
      g.titleCn.includes(keywords) ||
      getStructuredSearchTerms(g).some(t => t.includes(keywords)) ||
      g.tags.some(t => t.includes(keywords)) ||
      g.oneLiner.includes(keywords)
    );
  }

  // Apply Exclusions
  matchedGames = matchedGames.filter(g => !excludeIds.includes(g.id));

  // Fallback if no specific match
  if (matchedGames.length === 0) {
    // If we ran out of matches, try to find ANY game not excluded
    const allAvailable = GAME_DATABASE.filter(g => !excludeIds.includes(g.id));
    if (allAvailable.length > 0) {
      matchedGames = allAvailable.slice(0, 3);
      thoughtProcess += " -> 关键词匹配结果已耗尽，推荐其他热门游戏";
    } else {
      // Worst case: recommend random
      matchedGames = GAME_DATABASE.slice(0, 3);
      thoughtProcess += " -> 题库已空，随机兜底";
    }
  } else {
    thoughtProcess += ` -> 匹配到 ${matchedGames.length} 款游戏`;
  }

  // Rerank / Randomize slightly to avoid same result every time
  const recommendedGame = matchedGames[Math.floor(Math.random() * matchedGames.length)];

  const reply = `根据你的描述，我觉得 **《${recommendedGame.titleCn}》** 很适合！\n\n${recommendedGame.oneLiner} `;

  return JSON.stringify({
    thought: thoughtProcess,
    reply: reply,
    recommendation_id: recommendedGame.id
  });
}

function parseStructuredLLMResponse(responseText: string) {
  const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
  const candidates = [cleaned];

  const firstBraceIndex = cleaned.indexOf('{');
  const lastBraceIndex = cleaned.lastIndexOf('}');
  if (firstBraceIndex !== -1 && lastBraceIndex > firstBraceIndex) {
    candidates.push(cleaned.slice(firstBraceIndex, lastBraceIndex + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying looser candidates below.
    }
  }

  return null;
}

function extractFallbackReplyText(responseText: string) {
  const cleaned = responseText.replace(/```json\s*|\s*```/g, '').trim();
  if (!cleaned) {
    return '';
  }

  const replyMatch = cleaned.match(/"reply"\s*:\s*"([\s\S]*?)"(?:\s*,|\s*})/);
  if (replyMatch?.[1]) {
    try {
      return JSON.parse(`"${replyMatch[1]}"`);
    } catch {
      // Fall through to plain-text fallback.
    }
  }

  return cleaned.startsWith('{') ? '' : cleaned;
}

// 主函数：获取LLM回复
export async function getLLMResponse(
  userInput: string,
  mode: ChatMode = 'recommendation',
  activeGame?: Game,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  excludeIds: string[] = []
): Promise<{ text: string; gameId?: string; switchMode?: boolean; unknownGame?: string }> {

  const currentUserQuestion = extractCurrentUserQuestion(userInput);
  let retrievedRulesContext = '';
  let retrievedRuleCitations: RagCitation[] = [];
  let recommendationContext = '';
  let recommendationIntent: RecommendationIntent = { desiredTags: [], searchTerms: [] };
  let recommendationCandidates: RecommendationCandidate[] = [];
  const shouldUseKnowledgeRetrieval = !shouldSkipKnowledgeRetrieval(currentUserQuestion, mode);
  const excludedRecommendationNames = excludeIds
    .map((gameId) => GAME_DATABASE.find((game) => game.id === gameId)?.titleCn)
    .filter((title): title is string => Boolean(title))
    .slice(-8);

  if (mode === 'referee' && activeGame && shouldUseKnowledgeRetrieval) {
    try {
      const hits = await queryKnowledgeBase(currentUserQuestion, {
        topK: 4,
        where: {
          $and: [
            { mode: 'referee' },
            { game_id: activeGame.id },
          ],
        },
      });

      if (hits.length > 0) {
        const evidencePack = buildRagEvidencePack(hits);
        retrievedRulesContext = evidencePack.contextText;
        retrievedRuleCitations = evidencePack.citations;
      }
    } catch (error) {
      console.warn('Python RAG unavailable, falling back to embedded knowledge base:', error);
    }
  } else if (mode === 'recommendation' && shouldUseKnowledgeRetrieval) {
    recommendationIntent = parseRecommendationIntent(currentUserQuestion);
    try {
      const hits = await queryKnowledgeBase(buildRecommendationRetrievalQuery(currentUserQuestion, recommendationIntent), {
        topK: 12,
        where: buildRecommendationWhere(recommendationIntent),
      });
      recommendationCandidates = buildRecommendationCandidates(hits, excludeIds, recommendationIntent);

      if (recommendationCandidates.length > 0) {
        recommendationContext = formatRecommendationContext(recommendationCandidates, recommendationIntent);
      }
    } catch (error) {
      console.warn('Python RAG unavailable, falling back to full database summary:', error);
    }

    if (recommendationCandidates.length === 0) {
      recommendationCandidates = buildLocalRecommendationCandidates(currentUserQuestion, recommendationIntent, excludeIds);
      if (recommendationCandidates.length > 0) {
        recommendationContext = formatRecommendationContext(recommendationCandidates, recommendationIntent);
      }
    }
  }

  // 1. 准备 System Prompt
  const systemPrompt = getSystemInstruction({
    mode,
    activeGame,
    retrievedRulesContext,
    retrievedRuleCitations,
    recommendationContext,
    excludedRecommendationNames,
  });

  // 2. 准备消息历史
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userInput },
  ];

  let responseText = '';

  // 3. 调用 API 或 模拟
  if (!useMockMode && currentConfig) {
    try {
      responseText = await callLLMAPI(messages, mode);
    } catch (error) {
      console.error('LLM调用失败，转为模拟:', error);
      responseText = mockLLMResponse(currentUserQuestion, mode, activeGame, excludeIds);
    }
  } else {
    responseText = mockLLMResponse(currentUserQuestion, mode, activeGame, excludeIds);
  }

  // 4. 解析 JSON
  const parsedResult = parseStructuredLLMResponse(responseText);

  if (parsedResult) {
    if (mode === 'recommendation') {
      let finalId = parsedResult.recommendation_id;
      const recName = parsedResult.recommendation_name;
      const allowedCandidateIds = new Set(recommendationCandidates.map((candidate) => candidate.game.id));

      // 修复 Markdown 换行问题：处理可能存在的双重转义换行符
      // 进一步将 literal "\\n" 替换为真实换行，且将 "\\*" 还原为 "*" 以防 Markdown 渲染失败
      const text = String(parsedResult.reply || "").replace(/\\n/g, '\n').replace(/\\\*/g, '*');

      // 先从回复正文提取被真正点名的游戏，避免 JSON ID 被模型写错时误导前端
      const matches = Array.from(text.matchAll(/[《【](.*?)[》】]/g)).map((m: any) => m[1].replace(/[*_]/g, '').trim());
      const detectedGames = matches
        .map(name => GAME_DATABASE.find(g => g.titleCn === name || g.titleEn === name))
        .filter(g => g);
      const detectedGameId = detectedGames.length > 0
        ? detectedGames[detectedGames.length - 1]!.id
        : undefined;

      const primaryGameById = GAME_DATABASE.find(g => g.id === finalId);
      const primaryGameByName = GAME_DATABASE.find(g => g.titleCn === recName || g.titleEn === recName);

      if (detectedGameId && primaryGameById && primaryGameById.id !== detectedGameId) {
        finalId = detectedGameId;
      } else if (detectedGameId && primaryGameByName && primaryGameByName.id !== detectedGameId) {
        finalId = detectedGameId;
      } else if (primaryGameById) {
        finalId = primaryGameById.id;
      } else if (primaryGameByName) {
        finalId = primaryGameByName.id;
      } else if (detectedGameId) {
        finalId = detectedGameId;
      }

      // 最后防线：确保 ID 真实存在
      if (finalId && !GAME_DATABASE.some(g => g.id === finalId)) {
        finalId = undefined;
      }

      if (
        finalId &&
        allowedCandidateIds.size > 0 &&
        !allowedCandidateIds.has(finalId) &&
        !excludeIds.includes(finalId) &&
        !parsedResult.unknown_target_game
      ) {
        const fallbackCandidate = recommendationCandidates[0];
        if (fallbackCandidate) {
          return {
            text: buildCandidateFallbackReply(fallbackCandidate, 'out_of_pool'),
            gameId: fallbackCandidate.game.id,
          };
        }
      }

      return {
        text: text || "我好像走神了...",
        gameId: finalId,
        unknownGame: parsedResult.unknown_target_game
      };
    }

    const replyText = String(parsedResult.reply || '').replace(/\\n/g, '\n').replace(/\\\*/g, '*');
    const finalText = buildCitationReferenceBlock(replyText, retrievedRuleCitations);
    return {
      text: finalText || "规则判定中...",
      switchMode: parsedResult.switch_to_recommendation
    };
  }

  console.error("JSON Parse Error", responseText);
  const fallbackReplyText = extractFallbackReplyText(responseText);

  if (mode === 'recommendation') {
    if (fallbackReplyText) {
      return {
        text: fallbackReplyText,
      };
    }
    if (recommendationCandidates.length > 0) {
      const fallbackCandidate = recommendationCandidates[0];
      return {
        text: buildCandidateFallbackReply(fallbackCandidate),
        gameId: fallbackCandidate.game.id,
      };
    }
    return {
      text: fallbackReplyText || "我先换个问法帮你推荐。你想几个人玩、玩多久、偏热闹还是烧脑？",
    };
  }

  return {
    text: buildCitationReferenceBlock(
      fallbackReplyText || "我先按当前理解给你判一下，你也可以补一句更具体的场上情况。",
      retrievedRuleCitations,
    ),
  };
}

// 初始化配置
export function initLLMConfig() {
  const targetConfig: LLMConfig = {
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v3-1-terminus',
    provider: 'volcengine'
  };

  // 立即生效
  currentConfig = targetConfig;
  useMockMode = false;

  console.log('LLM Config initialized (Volcengine forced)');

  // 尝试持久化
  try {
    localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(targetConfig));
  } catch (e) {
    console.warn('Failed to save config to localStorage', e);
  }
}

// 保存配置 (Legacy support, might not be used if we force config)
export function saveLLMConfig(apiKey: string, provider: string, mockMode: boolean) {
  if (mockMode) {
    useMockMode = true;
    currentConfig = null;
    localStorage.setItem('llm_mock_mode', 'true');
  } else {
    try {
      setLLMConfig(apiKey, provider);
      if (currentConfig) {
        localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(currentConfig));
      }
      useMockMode = false;
      localStorage.setItem('llm_mock_mode', 'false');
    } catch (e) {
      console.error('保存LLM配置失败:', e);
    }
  }
}

// 获取推荐游戏
export async function getGameRecommendation(
  query: string,
  excludeIds: string[] = [],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  mode: ChatMode = 'recommendation',
  activeGame?: Game
): Promise<{ text: string; game?: Game; switchMode?: boolean }> {
  const { text, gameId, switchMode, unknownGame } = await getLLMResponse(query, mode, activeGame, history, excludeIds);

  if (unknownGame) {
    try {
      const stored = localStorage.getItem('unknown_game_queries');
      const queries = stored ? JSON.parse(stored) : [];
      queries.push({ query: unknownGame, originalInput: query, timestamp: Date.now() });
      localStorage.setItem('unknown_game_queries', JSON.stringify(queries));
      console.log(`[LLM Service] Logged unknown game: ${unknownGame}`);
    } catch (e) {
      console.warn('Failed to log unknown game', e);
    }
  }

  if (gameId) {
    const game = GAME_DATABASE.find(g => g.id === gameId);
    if (game) {
      return { text, game, switchMode };
    }
  }

  return { text, switchMode };
}

// 获取当前API提供商
export function getCurrentProvider(): string {
  return currentConfig?.baseUrl.includes('deepseek') ? 'deepseek' :
    currentConfig?.baseUrl.includes('moonshot') ? 'moonshot' :
      currentConfig?.baseUrl.includes('siliconflow') ? 'siliconflow' :
        'openai';
}

// 获取相似游戏
export function getSimilarGames(gameId: string, excludeIds: string[] = []): Game[] {
  const game = GAME_DATABASE.find(g => g.id === gameId);
  if (!game) return [];

  // 基于标签 + 最佳人数重叠的推荐算法
  return GAME_DATABASE.filter(g =>
    g.id !== gameId &&
    !excludeIds.includes(g.id) &&
    (getStructuredRecommendationTags(g).some(t => getStructuredRecommendationTags(game).includes(t)) ||
      (g.bestPlayerCount && game.bestPlayerCount && g.bestPlayerCount.some(n => game.bestPlayerCount!.includes(n))))
  ).sort((a, b) => {
    // 标签匹配度
    const gameTags = getStructuredRecommendationTags(game);
    const aTagMatch = getStructuredRecommendationTags(a).filter(t => gameTags.includes(t)).length;
    const bTagMatch = getStructuredRecommendationTags(b).filter(t => gameTags.includes(t)).length;
    // bestPlayerCount 重叠度
    const aBestMatch = (a.bestPlayerCount && game.bestPlayerCount) ? a.bestPlayerCount.filter(n => game.bestPlayerCount!.includes(n)).length : 0;
    const bBestMatch = (b.bestPlayerCount && game.bestPlayerCount) ? b.bestPlayerCount.filter(n => game.bestPlayerCount!.includes(n)).length : 0;
    return (bTagMatch + bBestMatch * 2) - (aTagMatch + aBestMatch * 2);
  });
}
