import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const PROJECT_ROOT = process.cwd();
const WIKI_ENTRY_FILE = path.join(PROJECT_ROOT, 'src/data/wikiCompilationBundle.ts');
const GAME_DATABASE_ENTRY_FILE = path.join(PROJECT_ROOT, 'src/data/gameDatabase.ts');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'knowledge');
const DOCUMENT_OUTPUT_FILE = path.join(OUTPUT_DIR, 'boardgame_kb.jsonl');
const SECTION_OUTPUT_FILE = path.join(OUTPUT_DIR, 'boardgame_kb_sections.jsonl');
const RECOMMENDATION_OUTPUT_FILE = path.join(OUTPUT_DIR, 'boardgame_recommendation_kb.jsonl');
const INTERNAL_WIKI_COMPILE_VERSION = '2026-05-09.v1';

function getKnowledgeTier(game) {
  return game.knowledgeTier || (compactText(game.knowledgeBase).length > 0 ? 'full' : 'catalog');
}

function isRefereeReadyGame(game) {
  return getKnowledgeTier(game) === 'full';
}

function getSourceFile(game) {
  return getKnowledgeTier(game) === 'catalog'
    ? 'src/data/gameDatabaseCatalogExpansion.ts'
    : 'src/data/gameDatabase.ts';
}

function compactText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function joinValues(values) {
  return toArray(values)
    .map((value) => compactText(value))
    .filter(Boolean)
    .join(' | ');
}

function getRecommendationProfile(game) {
  return game.recommendationProfile || {
    playerTags: [],
    durationTags: [],
    complexityTags: [],
    occasionTags: [],
    interactionTags: [],
    mechanicTags: [],
    moodTags: [],
    themeTags: [],
    allTags: [],
    searchTerms: [],
  };
}

function groupApprovedPatches(approvedPatches) {
  const grouped = new Map();

  for (const patch of toArray(approvedPatches)) {
    if (!patch || typeof patch !== 'object') {
      continue;
    }

    const gameId = compactText(patch.gameId);
    const mode = compactText(patch.mode);
    if (!gameId || !mode) {
      continue;
    }

    const key = `${mode}:${gameId}`;
    const existing = grouped.get(key) || [];
    existing.push(patch);
    grouped.set(key, existing);
  }

  return grouped;
}

function getApprovedPatchSections(groupedPatches, gameId, mode) {
  return (groupedPatches.get(`${mode}:${gameId}`) || [])
    .filter((patch) => compactText(patch.content))
    .map((patch, index) => ({
      document_id: `${mode}:${gameId}:approved_patch:${patch.id || index + 1}`,
      section_id: `approved_patch_${index + 1}`,
      section_type: 'wiki_patch',
      heading: compactText(patch.title) || '已批准知识修补',
      content: compactText(patch.content),
      chapter_id: compactText(patch.targetChapterId) || 'approved_patch',
      chapter_title: compactText(patch.title) || '已批准知识修补',
      chapter_rank: 90 + index,
      chapter_keywords: toArray(patch.keywords).filter(Boolean),
      wiki_compile_version: INTERNAL_WIKI_COMPILE_VERSION,
      wiki_mode: mode,
      wiki_visibility: 'internal',
      patch_id: compactText(patch.id),
      patch_type: compactText(patch.patchType) || 'append',
      patch_approved_at: compactText(patch.approvedAt),
      patch_feedback_ids: toArray(patch.basedOnFeedbackIds).filter(Boolean),
      source_fields: toArray(patch.sourceFields).filter(Boolean),
    }));
}

function getRefereeWikiMetadata(sectionId) {
  const chapterMap = {
    summary: {
      chapter_id: 'game_overview',
      chapter_title: '游戏概览',
      chapter_rank: 0,
      chapter_keywords: ['概览', '简介'],
    },
    rules_target: {
      chapter_id: 'win_condition',
      chapter_title: '胜利与终局',
      chapter_rank: 1,
      chapter_keywords: ['获胜', '胜利', '终局', '计分'],
    },
    rules_flow: {
      chapter_id: 'turn_structure',
      chapter_title: '回合流程',
      chapter_rank: 2,
      chapter_keywords: ['流程', '步骤', '回合'],
    },
    rules_tips: {
      chapter_id: 'teach_and_tips',
      chapter_title: '教学提醒',
      chapter_rank: 3,
      chapter_keywords: ['新手', '提醒', '技巧'],
    },
    faq: {
      chapter_id: 'faq_resolution',
      chapter_title: '常见争议裁定',
      chapter_rank: 10,
      chapter_keywords: ['faq', '争议', '裁定', '能不能'],
    },
    knowledge_base: {
      chapter_id: 'rule_detail',
      chapter_title: '关键规则细节',
      chapter_rank: 20,
      chapter_keywords: ['关键规则', '限制', '例外', '结算'],
    },
  };

  return chapterMap[sectionId] || {
    chapter_id: sectionId,
    chapter_title: sectionId,
    chapter_rank: 99,
    chapter_keywords: [],
  };
}

function getRecommendationWikiMetadata(sectionId) {
  const chapterMap = {
    rec_summary: {
      chapter_id: 'fit_summary',
      chapter_title: '总体适配摘要',
      chapter_rank: 1,
      chapter_keywords: ['总体适配', '一句话'],
    },
    rec_fit: {
      chapter_id: 'player_and_time_fit',
      chapter_title: '人数与时长适配',
      chapter_rank: 2,
      chapter_keywords: ['人数', '时长', '节奏'],
    },
    rec_tags: {
      chapter_id: 'mood_and_mechanic_fit',
      chapter_title: '氛围与机制适配',
      chapter_rank: 4,
      chapter_keywords: ['氛围', '互动', '机制', '场景'],
    },
    rec_search: {
      chapter_id: 'search_aliases',
      chapter_title: '检索别名',
      chapter_rank: 8,
      chapter_keywords: ['搜索词', '别名', '标签'],
    },
  };

  return chapterMap[sectionId] || {
    chapter_id: sectionId,
    chapter_title: sectionId,
    chapter_rank: 99,
    chapter_keywords: [],
  };
}

function formatListLine(label, values) {
  const joined = joinValues(values);
  return joined ? `- ${label}：${joined}` : '';
}

function joinNonEmptyPhrases(values) {
  return values
    .map((value) => compactText(value))
    .filter(Boolean)
    .join('、');
}

function buildRecommendationHighlights(profile) {
  const phrases = [];

  if (profile.occasionTags.includes('情侣约会')) {
    phrases.push('适合两个人约会');
  }
  if (profile.occasionTags.includes('朋友聚会')) {
    phrases.push('适合朋友聚会和人多热闹的场合');
  }
  if (profile.occasionTags.includes('团建破冰')) {
    phrases.push('适合破冰、聊天和带话题');
  }
  if (profile.interactionTags.includes('合作共赢')) {
    phrases.push('偏合作取向，不想互相伤害时很合适');
  }
  if (profile.interactionTags.includes('阵营推理')) {
    phrases.push('有明显的身份、阵营和推理体验');
  }
  if (profile.interactionTags.includes('嘴炮谈判')) {
    phrases.push('嘴炮和谈判比机械操作更重要');
  }
  if (profile.interactionTags.includes('高互动对抗')) {
    phrases.push('互动强，对抗感明显');
  }
  if (profile.moodTags.includes('轻松休闲')) {
    phrases.push('整体轻松，上手很快');
  }
  if (profile.moodTags.includes('烧脑策略')) {
    phrases.push('这是一款偏烧脑的策略游戏，适合想认真思考的人');
  }
  if (profile.mechanicTags.includes('猜词联想')) {
    phrases.push('适合喜欢说话、表达和联想的玩家');
  }
  if (profile.mechanicTags.includes('手速反应')) {
    phrases.push('节奏快，偏手速和反应');
  }

  return phrases.slice(0, 6);
}

function buildRecommendationQueryTemplates(game, profile) {
  const templates = [];

  if (
    profile.playerTags.includes('双人核心') &&
    profile.occasionTags.includes('情侣约会') &&
    profile.moodTags.includes('轻松休闲') &&
    game.playtimeMin <= 30
  ) {
    templates.push('如果你们是两个人约会，想轻松一点、半小时内结束，这款通常很合适。');
  }

  if (
    profile.playerTags.includes('双人核心') &&
    profile.interactionTags.includes('高互动对抗') &&
    game.playtimeMin <= 30
  ) {
    templates.push('如果你想玩双人对抗、有点博弈感、又不想太拖，这款通常很合适。');
  }

  if (
    (profile.playerTags.includes('5人以上佳') || profile.playerTags.includes('大团体适配')) &&
    profile.occasionTags.includes('朋友聚会') &&
    (profile.moodTags.includes('欢乐搞笑') || profile.mechanicTags.includes('手速反应'))
  ) {
    templates.push('如果你们有6个人以上，想在聚会里玩得热闹搞笑一点，这款通常很合适。');
  }

  if (
    profile.occasionTags.includes('团建破冰') &&
    (profile.mechanicTags.includes('猜词联想') || profile.interactionTags.includes('合作共赢'))
  ) {
    templates.push('如果你想找能破冰、说话聊天多一点的桌游，这款通常很合适。');
  }

  if (
    profile.interactionTags.includes('合作共赢') &&
    profile.moodTags.includes('低冲突友好')
  ) {
    templates.push('如果是4个人新手，想玩合作类，又不想互相伤害，这款通常很合适。');
  }

  if (
    profile.playerTags.includes('3到4人佳') &&
    (profile.moodTags.includes('烧脑策略') || profile.complexityTags.includes('重策略') || profile.complexityTags.includes('中策略'))
  ) {
    templates.push('如果你们是3到4个人，想玩偏烧脑的策略游戏，这款通常很合适。');
  }

  if (
    profile.occasionTags.includes('朋友聚会') &&
    profile.moodTags.includes('轻松休闲') &&
    game.playtimeMin <= 20
  ) {
    templates.push('如果你想来一个上手快、20分钟左右的聚会游戏，这款通常很合适。');
  }

  if (
    (profile.playerTags.includes('5人以上佳') || profile.playerTags.includes('大团体适配')) &&
    profile.interactionTags.includes('阵营推理')
  ) {
    templates.push('如果你们人多，想玩嘴炮和推理都有的阵营游戏，这款通常很合适。');
  }

  return templates;
}

function createRecommendationSections(game) {
  const profile = getRecommendationProfile(game);
  const highlightText = buildRecommendationHighlights(profile).map((item) => `- ${item}`).join('\n');
  const templateText = buildRecommendationQueryTemplates(game, profile).map((item) => `- ${item}`).join('\n');
  const bestPlayerText = joinValues(toArray(game.bestPlayerCount).map(String)) || `${game.minPlayers}-${game.maxPlayers}`;
  const searchTermsText = joinValues(profile.searchTerms);
  const userDescriptionHints = joinNonEmptyPhrases([
    joinValues(profile.occasionTags),
    joinValues(profile.moodTags),
    joinValues(profile.interactionTags),
    joinValues(profile.mechanicTags),
  ]);

  return [
    {
      section_id: 'rec_summary',
      section_type: 'recommendation',
      heading: '推荐摘要',
      content: compactText(`
《${game.titleCn}》适合 ${joinValues(profile.occasionTags) || '多种常见组局场景'}。
它通常支持 ${game.minPlayers}-${game.maxPlayers} 人，最佳体验常见于 ${bestPlayerText} 人，一局约 ${game.playtimeMin} 分钟。
这款游戏的推荐定位包括：${joinValues(profile.allTags)}。
      `),
    },
    {
      section_id: 'rec_fit',
      section_type: 'recommendation',
      heading: '适合场景',
      content: compactText([
        game.oneLiner,
        '',
        highlightText,
        templateText,
      ].filter(Boolean).join('\n')),
    },
    {
      section_id: 'rec_tags',
      section_type: 'recommendation',
      heading: '结构化词条',
      content: compactText([
        formatListLine('人数词条', profile.playerTags),
        formatListLine('时长词条', profile.durationTags),
        formatListLine('难度词条', profile.complexityTags),
        formatListLine('场景词条', profile.occasionTags),
        formatListLine('互动词条', profile.interactionTags),
        formatListLine('机制词条', profile.mechanicTags),
        formatListLine('氛围词条', profile.moodTags),
        formatListLine('主题词条', profile.themeTags),
        formatListLine('检索别名', profile.searchTerms),
      ].filter(Boolean).join('\n')),
    },
    {
      section_id: 'rec_search',
      section_type: 'recommendation',
      heading: '推荐检索语料',
      content: compactText([
        `如果用户想找：${searchTermsText || joinValues(profile.allTags)}，这款游戏都应被视为高相关候选。`,
        userDescriptionHints ? `用户可能会这样描述它：${userDescriptionHints}。` : '',
        buildRecommendationQueryTemplates(game, profile).join('\n'),
      ].filter(Boolean).join('\n')),
    },
  ].filter((section) => section.content.length > 0);
}

function createSectionDocuments(game, groupedApprovedPatches) {
  const baseMetadata = {
    game_id: game.id,
    title_cn: game.titleCn,
    title_en: game.titleEn,
    aliases: [game.titleCn, game.titleEn].filter(Boolean),
    tags: toArray(game.tags),
    best_player_count: toArray(game.bestPlayerCount),
    min_players: game.minPlayers,
    max_players: game.maxPlayers,
    playtime_min: game.playtimeMin,
    age_rating: game.ageRating,
    complexity: game.complexity,
    bilibili_id: game.bilibiliId || '',
    tutorial_video_url: game.tutorialVideoUrl || '',
    bgg_id: game.bggId || '',
    bgg_url: game.bggUrl || '',
    knowledge_tier: getKnowledgeTier(game),
  };

  const rawSections = [
    {
      section_id: 'summary',
      section_type: 'summary',
      heading: '一句话介绍',
      content: compactText(game.oneLiner),
    },
    {
      section_id: 'rules_target',
      section_type: 'rules',
      heading: '获胜目标',
      content: compactText(game.rules?.target),
    },
    {
      section_id: 'rules_flow',
      section_type: 'rules',
      heading: '游戏流程',
      content: compactText(game.rules?.flow),
    },
    {
      section_id: 'rules_tips',
      section_type: 'tips',
      heading: '新手技巧',
      content: compactText(game.rules?.tips),
    },
    {
      section_id: 'faq',
      section_type: 'faq',
      heading: '常见问题',
      content: compactText(game.FAQ),
    },
    {
      section_id: 'knowledge_base',
      section_type: 'knowledge_base',
      heading: '知识库',
      content: compactText(game.knowledgeBase),
    },
  ].filter((section) => section.content.length > 0);

  const commonQuestions = toArray(game.commonQuestions)
    .map((question) => compactText(question))
    .filter(Boolean);

  const compiledSections = rawSections.map((section) => ({
    ...getRefereeWikiMetadata(section.section_id),
    document_id: `${game.id}:${section.section_id}`,
    ...baseMetadata,
    source_file: getSourceFile(game),
    heading: section.heading,
    section_id: section.section_id,
    section_type: section.section_type,
    wiki_compile_version: INTERNAL_WIKI_COMPILE_VERSION,
    wiki_mode: 'referee',
    wiki_visibility: 'internal',
    content: section.content,
    char_count: section.content.length,
    common_questions: commonQuestions,
    search_text: [
      game.titleCn,
      game.titleEn,
      section.heading,
      commonQuestions.join('\n'),
      section.content,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));

  const approvedPatchSections = getApprovedPatchSections(groupedApprovedPatches, game.id, 'referee').map((section) => ({
    ...baseMetadata,
    source_file: 'src/data/wikiApprovedPatches.ts',
    char_count: section.content.length,
    common_questions: commonQuestions,
    search_text: [
      game.titleCn,
      game.titleEn,
      section.heading,
      joinValues(section.chapter_keywords),
      section.content,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ...section,
  }));

  return [...compiledSections, ...approvedPatchSections];
}

function createRecommendationSectionDocuments(game, groupedApprovedPatches) {
  const profile = getRecommendationProfile(game);
  const baseMetadata = {
    game_id: game.id,
    title_cn: game.titleCn,
    title_en: game.titleEn,
    aliases: [game.titleCn, game.titleEn].filter(Boolean),
    tags: toArray(game.tags),
    recommendation_tags: toArray(profile.allTags),
    best_player_count: toArray(game.bestPlayerCount),
    min_players: game.minPlayers,
    max_players: game.maxPlayers,
    playtime_min: game.playtimeMin,
    age_rating: game.ageRating,
    complexity: game.complexity,
    bilibili_id: game.bilibiliId || '',
    tutorial_video_url: game.tutorialVideoUrl || '',
    bgg_id: game.bggId || '',
    bgg_url: game.bggUrl || '',
    knowledge_tier: getKnowledgeTier(game),
  };

  const compiledSections = createRecommendationSections(game).map((section) => ({
    ...getRecommendationWikiMetadata(section.section_id),
    document_id: `recommendation:${game.id}:${section.section_id}`,
    ...baseMetadata,
    source_file: getSourceFile(game),
    heading: section.heading,
    section_id: section.section_id,
    section_type: section.section_type,
    wiki_compile_version: INTERNAL_WIKI_COMPILE_VERSION,
    wiki_mode: 'recommendation',
    wiki_visibility: 'internal',
    content: section.content,
    char_count: section.content.length,
    search_text: [
      game.titleCn,
      game.titleEn,
      section.heading,
      joinValues(profile.allTags),
      joinValues(profile.searchTerms),
      section.content,
    ]
      .filter(Boolean)
      .join('\n\n'),
  }));

  const approvedPatchSections = getApprovedPatchSections(groupedApprovedPatches, game.id, 'recommendation').map((section) => ({
    ...baseMetadata,
    source_file: 'src/data/wikiApprovedPatches.ts',
    char_count: section.content.length,
    search_text: [
      game.titleCn,
      game.titleEn,
      section.heading,
      joinValues(section.chapter_keywords),
      section.content,
    ]
      .filter(Boolean)
      .join('\n\n'),
    ...section,
  }));

  return [...compiledSections, ...approvedPatchSections];
}

function createKnowledgeDocument(game, groupedApprovedPatches) {
  const sections = createSectionDocuments(game, groupedApprovedPatches).map((section) => ({
    section_id: section.section_id,
    title: section.heading,
    text: section.content,
    metadata: {
      section_type: section.section_type,
      char_count: section.char_count,
      chapter_id: section.chapter_id,
      patch_id: section.patch_id || '',
    },
  }));

  return {
    document_id: game.id,
    title: game.titleCn,
    source: 'boardgame_kb_export',
    metadata: {
      mode: 'referee',
      game_id: game.id,
      title_cn: game.titleCn,
      title_en: game.titleEn,
      aliases_text: joinValues([game.titleCn, game.titleEn]),
      tags_text: joinValues(game.tags),
      best_player_count_text: joinValues(toArray(game.bestPlayerCount).map(String)),
      min_players: game.minPlayers,
      max_players: game.maxPlayers,
      playtime_min: game.playtimeMin,
      age_rating: game.ageRating,
      complexity: game.complexity,
      bilibili_id: game.bilibiliId || '',
      tutorial_video_url: game.tutorialVideoUrl || '',
      bgg_id: game.bggId || '',
      bgg_url: game.bggUrl || '',
      knowledge_tier: getKnowledgeTier(game),
      common_questions_text: joinValues(game.commonQuestions),
      wiki_compile_version: INTERNAL_WIKI_COMPILE_VERSION,
      wiki_visibility: 'internal',
    },
    sections,
  };
}

function createRecommendationDocument(game, groupedApprovedPatches) {
  const profile = getRecommendationProfile(game);
  const sections = createRecommendationSectionDocuments(game, groupedApprovedPatches).map((section) => ({
    section_id: section.section_id,
    title: section.heading,
    text: section.content,
    metadata: {
      section_type: section.section_type,
      char_count: section.content.length,
      chapter_id: section.chapter_id,
      patch_id: section.patch_id || '',
    },
  }));

  return {
    document_id: `recommendation:${game.id}`,
    title: game.titleCn,
    source: 'boardgame_recommendation_export',
    metadata: {
      mode: 'recommendation',
      game_id: game.id,
      title_cn: game.titleCn,
      title_en: game.titleEn,
      aliases_text: joinValues([game.titleCn, game.titleEn]),
      display_tags_text: joinValues(game.tags),
      recommendation_tags_text: joinValues(profile.allTags),
      player_tags_text: joinValues(profile.playerTags),
      duration_tags_text: joinValues(profile.durationTags),
      complexity_tags_text: joinValues(profile.complexityTags),
      occasion_tags_text: joinValues(profile.occasionTags),
      interaction_tags_text: joinValues(profile.interactionTags),
      mechanic_tags_text: joinValues(profile.mechanicTags),
      mood_tags_text: joinValues(profile.moodTags),
      theme_tags_text: joinValues(profile.themeTags),
      search_terms_text: joinValues(profile.searchTerms),
      best_player_count_text: joinValues(toArray(game.bestPlayerCount).map(String)),
      min_players: game.minPlayers,
      max_players: game.maxPlayers,
      playtime_min: game.playtimeMin,
      age_rating: game.ageRating,
      complexity: game.complexity,
      bilibili_id: game.bilibiliId || '',
      tutorial_video_url: game.tutorialVideoUrl || '',
      bgg_id: game.bggId || '',
      bgg_url: game.bggUrl || '',
      knowledge_tier: getKnowledgeTier(game),
      wiki_compile_version: INTERNAL_WIKI_COMPILE_VERSION,
      wiki_visibility: 'internal',
    },
    sections,
  };
}

async function loadGameDatabase() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boardgame-kb-'));
  const bundleFile = path.join(tempDir, 'gameDatabase.bundle.mjs');
  const entryFile = (await fs.stat(WIKI_ENTRY_FILE).then(() => true).catch(() => false))
    ? WIKI_ENTRY_FILE
    : GAME_DATABASE_ENTRY_FILE;

  await build({
    entryPoints: [entryFile],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    alias: {
      '@': path.join(PROJECT_ROOT, 'src'),
    },
    logLevel: 'silent',
  });

  try {
    const moduleUrl = pathToFileURL(bundleFile).href;
    const gameModule = await import(moduleUrl);
    return {
      games: toArray(gameModule.GAME_DATABASE),
      approvedPatches: toArray(gameModule.WIKI_APPROVED_PATCHES),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const { games, approvedPatches } = await loadGameDatabase();
  const groupedApprovedPatches = groupApprovedPatches(approvedPatches);

  if (!games.length) {
    throw new Error('No games found in GAME_DATABASE');
  }

  const refereeReadyGames = games.filter(isRefereeReadyGame);
  const knowledgeDocuments = refereeReadyGames.map((game) => createKnowledgeDocument(game, groupedApprovedPatches));
  const recommendationDocuments = games.map((game) => createRecommendationDocument(game, groupedApprovedPatches));
  const combinedDocuments = [...knowledgeDocuments, ...recommendationDocuments];
  const sectionDocuments = games.flatMap((game) => [
    ...(isRefereeReadyGame(game) ? createSectionDocuments(game, groupedApprovedPatches) : []),
    ...createRecommendationSectionDocuments(game, groupedApprovedPatches),
  ]);
  const knowledgePayload = combinedDocuments.map((doc) => JSON.stringify(doc)).join('\n') + '\n';
  const recommendationPayload = recommendationDocuments.map((doc) => JSON.stringify(doc)).join('\n') + '\n';
  const sectionPayload = sectionDocuments.map((doc) => JSON.stringify(doc)).join('\n') + '\n';

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(DOCUMENT_OUTPUT_FILE, knowledgePayload, 'utf8');
  await fs.writeFile(RECOMMENDATION_OUTPUT_FILE, recommendationPayload, 'utf8');
  await fs.writeFile(SECTION_OUTPUT_FILE, sectionPayload, 'utf8');

  console.log(
    JSON.stringify(
      {
        games: games.length,
        knowledge_documents: combinedDocuments.length,
        referee_documents: knowledgeDocuments.length,
        recommendation_documents: recommendationDocuments.length,
        section_documents: sectionDocuments.length,
        approved_patches: approvedPatches.length,
        outputs: [
          path.relative(PROJECT_ROOT, DOCUMENT_OUTPUT_FILE),
          path.relative(PROJECT_ROOT, RECOMMENDATION_OUTPUT_FILE),
          path.relative(PROJECT_ROOT, SECTION_OUTPUT_FILE),
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
