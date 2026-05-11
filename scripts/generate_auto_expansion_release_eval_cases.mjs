import path from 'node:path';
import {
  PROJECT_ROOT,
  compactText,
  loadAutoExpansionDatabase,
  loadGameDatabase,
  writeJsonLines,
} from './lib/game_data_loader.mjs';

const DEFAULT_RECOMMENDATION_OUTPUT = 'rag_evals/data/auto_expansion_recommendation_eval_cases.jsonl';
const DEFAULT_REFEREE_OUTPUT = 'rag_evals/data/auto_expansion_referee_eval_cases.jsonl';
const DEFAULT_REFEREE_PRIMARY_OUTPUT = 'rag_evals/data/auto_expansion_referee_primary_eval_cases.jsonl';
const DEFAULT_REFEREE_FLOW_OUTPUT = 'rag_evals/data/auto_expansion_referee_flow_eval_cases.jsonl';
const DEFAULT_REFEREE_FAQ_OUTPUT = 'rag_evals/data/auto_expansion_referee_faq_eval_cases.jsonl';

function parseArgs(argv) {
  const args = {
    recommendationOutput: DEFAULT_RECOMMENDATION_OUTPUT,
    refereeOutput: DEFAULT_REFEREE_OUTPUT,
    refereePrimaryOutput: DEFAULT_REFEREE_PRIMARY_OUTPUT,
    refereeFlowOutput: DEFAULT_REFEREE_FLOW_OUTPUT,
    refereeFaqOutput: DEFAULT_REFEREE_FAQ_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--recommendation-output') {
      args.recommendationOutput = argv[index + 1] ?? DEFAULT_RECOMMENDATION_OUTPUT;
      index += 1;
      continue;
    }
    if (current === '--referee-output') {
      args.refereeOutput = argv[index + 1] ?? DEFAULT_REFEREE_OUTPUT;
      index += 1;
      continue;
    }
    if (current === '--referee-primary-output') {
      args.refereePrimaryOutput = argv[index + 1] ?? DEFAULT_REFEREE_PRIMARY_OUTPUT;
      index += 1;
      continue;
    }
    if (current === '--referee-flow-output') {
      args.refereeFlowOutput = argv[index + 1] ?? DEFAULT_REFEREE_FLOW_OUTPUT;
      index += 1;
      continue;
    }
    if (current === '--referee-faq-output') {
      args.refereeFaqOutput = argv[index + 1] ?? DEFAULT_REFEREE_FAQ_OUTPUT;
      index += 1;
    }
  }

  return args;
}

function unique(values) {
  return [...new Set(values.filter((value) => compactText(value).length > 0))];
}

function getProfile(game) {
  return game.recommendationProfile ?? {
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

function first(values) {
  return values.find((value) => compactText(value).length > 0) ?? '';
}

function hasTag(game, field, tag) {
  return getProfile(game)[field]?.includes(tag) ?? false;
}

function pickRecommendationKeywords(game) {
  const profile = getProfile(game);

  return unique([
    ...profile.occasionTags,
    ...profile.playerTags,
    ...profile.moodTags,
    ...profile.mechanicTags,
    ...profile.interactionTags,
    ...profile.durationTags,
    ...profile.searchTerms,
    ...profile.allTags,
    ...game.tags,
  ]).slice(0, 4);
}

function buildPlayerPhrase(game) {
  if (hasTag(game, 'playerTags', '双人核心')) {
    return '我们两个人';
  }
  if (hasTag(game, 'playerTags', '大团体适配')) {
    return '我们一大群人';
  }
  if (hasTag(game, 'playerTags', '5人以上佳')) {
    return '我们四五个人';
  }
  if (hasTag(game, 'playerTags', '3到4人佳')) {
    return '我们三四个人';
  }
  if (game.minPlayers === game.maxPlayers) {
    return `我们${game.minPlayers}个人`;
  }
  if (game.maxPlayers >= 5) {
    return '我们几个人聚会';
  }
  return '我们这一局';
}

function buildOccasionPrefix(game) {
  if (hasTag(game, 'occasionTags', '情侣约会')) {
    return '约会想找';
  }
  if (hasTag(game, 'occasionTags', '家庭同乐')) {
    return '想带家人一起玩';
  }
  if (hasTag(game, 'occasionTags', '团建破冰')) {
    return '团建破冰想找';
  }
  if (hasTag(game, 'occasionTags', '朋友聚会')) {
    return '朋友聚会想找';
  }
  return `${buildPlayerPhrase(game)}想找`;
}

function buildDurationPhrase(game) {
  const durationTag = first(getProfile(game).durationTags);
  if (durationTag === '15分钟内') {
    return '十几分钟就能收掉';
  }
  if (durationTag === '30分钟内') {
    return '半小时内能结束';
  }
  if (durationTag === '60分钟以上') {
    return '愿意玩久一点';
  }
  if (durationTag === '60分钟内') {
    return '一小时内差不多能打完';
  }
  if (game.playtimeMin) {
    return `${game.playtimeMin}分钟左右`;
  }
  return '';
}

function buildScenarioFragments(game) {
  const profile = getProfile(game);
  const durationPhrase = buildDurationPhrase(game);
  return unique([
    first(profile.playerTags),
    first(profile.moodTags),
    first(profile.mechanicTags),
    first(profile.themeTags),
    ...game.tags,
    durationPhrase,
    first(profile.complexityTags),
  ]).slice(0, 4);
}

function buildRecommendationQuery(game) {
  const keywords = pickRecommendationKeywords(game);
  const fragments = [];

  if (keywords[0]) {
    fragments.push(keywords[0]);
  }
  if (keywords[1]) {
    fragments.push(keywords[1]);
  }
  if (game.playtimeMin) {
    fragments.push(`${game.playtimeMin}分钟左右`);
  }

  return `推荐一下《${game.titleCn}》，我想找${fragments.join('、') || '适合上桌'}的桌游。`;
}

function buildScenarioRecommendationQuery(game) {
  const prefix = buildOccasionPrefix(game);
  const fragments = buildScenarioFragments(game);
  const descriptor = fragments.join('、') || '适合现在这局';
  return `${prefix}《${game.titleCn}》这种${descriptor}的桌游。`;
}

function buildRecommendationCase(game) {
  const keywords = pickRecommendationKeywords(game);

  return {
    id: `auto-rec-${game.id}`,
    mode: 'recommendation',
    category: 'auto_expansion_exact_title',
    query: buildRecommendationQuery(game),
    expected: {
      must_game_ids: [game.id],
      any_game_ids: [],
      must_not_game_ids: [],
      keyword_groups: keywords.length > 0 ? [keywords] : [],
      min_recall_at_k: keywords.length > 0 ? 1.0 : 1.0,
    },
    notes: 'Auto-expansion release gate: exact-title recommendation retrievability.',
  };
}

function buildScenarioRecommendationCase(game) {
  const keywords = buildScenarioFragments(game);

  return {
    id: `auto-rec-scenario-${game.id}`,
    mode: 'recommendation',
    category: 'auto_expansion_exact_title_scenario',
    query: buildScenarioRecommendationQuery(game),
    expected: {
      must_game_ids: [game.id],
      any_game_ids: [],
      must_not_game_ids: [],
      keyword_groups: keywords.length > 0 ? [keywords] : [],
      min_recall_at_k: 1.0,
    },
    notes: 'Auto-expansion release gate: scenario-led exact-title recommendation phrasing should remain retrievable.',
  };
}

function buildRefereeQuery(game) {
  return `${game.titleCn}怎么赢？`;
}

function isWinQuestion(question) {
  return /(怎么赢|如何赢|怎么获胜|如何获胜|胜利条件|获胜条件)/.test(question);
}

function isFlowQuestion(question) {
  return /(一回合|怎么进行|如何进行|回合流程|流程|顺序|先.*后|什么时候|行动阶段|轮到|结算顺序)/.test(question);
}

function withQuestionMark(text) {
  const normalized = compactText(text).replace(/[？?]+$/u, '');
  return `${normalized}？`;
}

function buildFlowRefereeQuery(game) {
  return `《${game.titleCn}》一回合通常是先做什么、后做什么？`;
}

function buildQuestionWithTitle(game, question) {
  const normalized = compactText(question).replace(/[？?]+$/u, '');
  if (!normalized) {
    return `《${game.titleCn}》里有哪些关键判定要注意？`;
  }
  if (normalized.includes(game.titleCn) || normalized.includes(game.titleEn)) {
    return withQuestionMark(normalized);
  }
  if (/^(怎么|如何|为什么|可以|能不能|一回合|回合|终局|同分|先|后|什么时候|谁先|几张|几次)/.test(normalized)) {
    return withQuestionMark(`《${game.titleCn}》${normalized}`);
  }
  return withQuestionMark(`《${game.titleCn}》里${normalized}`);
}

function extractFaqQuestions(game) {
  return String(game.FAQ ?? '')
    .split('\n')
    .map((line) => {
      const match = line.match(/Q:\s*(.+?)(?:\*\*|$)/);
      return compactText(match?.[1] ?? '');
    })
    .filter(Boolean);
}

function scoreFaqQuestion(question) {
  if (!question) {
    return -100;
  }
  if (isWinQuestion(question)) {
    return -100;
  }

  let score = 0;

  if (/(计分|得分|分数|获胜|胜利|怎么赢|如何赢)/.test(question)) {
    score -= 20;
  }
  if (/(可以|能不能|必须|什么时候|先|后|限制|扣分|回收|覆盖|旋转|连接|重叠|使用|拿|放|移动|同分|终局|失败|出局|次数|几次|几张|资源)/.test(question)) {
    score += 10;
  }
  if (/(为什么|区别|差别|怎么办|怎么处理)/.test(question)) {
    score += 8;
  }
  if (isFlowQuestion(question)) {
    score += 4;
  }
  if (/(前期|后期|值不值得|该先|冲多快|更重要|更稳)/.test(question)) {
    score -= 6;
  }

  return score;
}

function pickFaqQuestion(game) {
  const questions = unique([
    ...extractFaqQuestions(game),
    ...(game.commonQuestions ?? []),
  ]);

  return questions
    .map((question) => ({ question, score: scoreFaqQuestion(question) }))
    .sort((left, right) => right.score - left.score || left.question.localeCompare(right.question))
    .map((entry) => entry.question)[0] ?? '';
}

function buildRefereeCase(game) {
  return {
    id: `auto-ref-${game.id}`,
    mode: 'referee',
    category: 'auto_expansion_primary_question',
    active_game_id: game.id,
    query: buildRefereeQuery(game),
    expected: {
      must_game_ids: [game.id],
      any_game_ids: [],
      must_not_game_ids: [],
      keyword_groups: [],
      min_recall_at_k: 1.0,
      top_1_section_any_of: ['获胜目标', 'rules_target'],
    },
    notes: 'Auto-expansion release gate: canonical win-condition query should land on the win-condition section first.',
  };
}

function buildFlowRefereeCase(game) {
  return {
    id: `auto-ref-flow-${game.id}`,
    mode: 'referee',
    category: 'auto_expansion_flow_question',
    active_game_id: game.id,
    query: buildFlowRefereeQuery(game),
    expected: {
      must_game_ids: [game.id],
      any_game_ids: [],
      must_not_game_ids: [],
      keyword_groups: [],
      min_recall_at_k: 1.0,
      top_1_section_any_of: ['游戏流程', 'rules_flow', '知识库', 'knowledge_base'],
    },
    notes: 'Auto-expansion release gate: generic turn-flow phrasing should land on a flow-oriented section.',
  };
}

function buildFaqRefereeCase(game) {
  const question = pickFaqQuestion(game);
  const query = buildQuestionWithTitle(game, question);

  return {
    id: `auto-ref-faq-${game.id}`,
    mode: 'referee',
    category: 'auto_expansion_faq_question',
    active_game_id: game.id,
    query,
    expected: {
      must_game_ids: [game.id],
      any_game_ids: [],
      must_not_game_ids: [],
      keyword_groups: [],
      min_recall_at_k: 1.0,
      top_1_section_any_of: ['常见问题', 'faq', '知识库', 'knowledge_base', '游戏流程', 'rules_flow'],
    },
    notes: 'Auto-expansion release gate: FAQ / edge-case phrasing should stay answerable from the exported referee docs.',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [autoExpansionGames, mergedGames] = await Promise.all([
    loadAutoExpansionDatabase(),
    loadGameDatabase(),
  ]);
  const mergedById = new Map(mergedGames.map((game) => [game.id, game]));

  const normalizedAutoGames = autoExpansionGames
    .map((game) => mergedById.get(game.id))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));

  const recommendationCases = normalizedAutoGames.flatMap((game) => [
    buildRecommendationCase(game),
    buildScenarioRecommendationCase(game),
  ]);
  const refereePrimaryCases = normalizedAutoGames.map(buildRefereeCase);
  const refereeFlowCases = normalizedAutoGames.map(buildFlowRefereeCase);
  const refereeFaqCases = normalizedAutoGames.map(buildFaqRefereeCase);
  const refereeCases = [
    ...refereePrimaryCases,
    ...refereeFlowCases,
    ...refereeFaqCases,
  ];

  await Promise.all([
    writeJsonLines(args.recommendationOutput, recommendationCases),
    writeJsonLines(args.refereeOutput, refereeCases),
    writeJsonLines(args.refereePrimaryOutput, refereePrimaryCases),
    writeJsonLines(args.refereeFlowOutput, refereeFlowCases),
    writeJsonLines(args.refereeFaqOutput, refereeFaqCases),
  ]);

  console.log(
    JSON.stringify(
      {
        autoExpansionGameCount: normalizedAutoGames.length,
        recommendationCaseCount: recommendationCases.length,
        refereeCaseCount: refereeCases.length,
        refereePrimaryCaseCount: refereePrimaryCases.length,
        refereeFlowCaseCount: refereeFlowCases.length,
        refereeFaqCaseCount: refereeFaqCases.length,
        recommendationOutput: path.relative(PROJECT_ROOT, path.join(PROJECT_ROOT, args.recommendationOutput)),
        refereeOutput: path.relative(PROJECT_ROOT, path.join(PROJECT_ROOT, args.refereeOutput)),
        refereePrimaryOutput: path.relative(
          PROJECT_ROOT,
          path.join(PROJECT_ROOT, args.refereePrimaryOutput),
        ),
        refereeFlowOutput: path.relative(PROJECT_ROOT, path.join(PROJECT_ROOT, args.refereeFlowOutput)),
        refereeFaqOutput: path.relative(PROJECT_ROOT, path.join(PROJECT_ROOT, args.refereeFaqOutput)),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
