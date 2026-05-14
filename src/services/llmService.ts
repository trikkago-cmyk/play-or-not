// LLM 服务 - 支持多种API提供商
import { GAME_DATABASE } from '@/data/gameDatabase';
import { getBgaPopularitySignal } from '@/data/bgaPopularitySignals';
import { buildInternalRecommendationContext, buildInternalRefereeContext, type InternalWikiCitation } from './internalWikiService';
import { hasLocalizedGameTitle, resolveMentionedGameInText } from './gameTextResolver';
import { getUserMemory } from './memoryService';
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
const VOLCENGINE_RECOMMENDATION_MODEL = 'deepseek-v3-2-251201';
const VOLCENGINE_REFEREE_MODEL = 'deepseek-v3-2-251201';

// 预设的API提供商
const API_PROVIDERS: Record<string, { baseUrl: string; model: string }> = {
  volcengine: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v3-2-251201',
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
  model: 'deepseek-v3-2-251201',
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
    provider,
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
  retrievedRuleCitations?: InternalWikiCitation[];
  recommendationContext?: string;
  excludedRecommendationNames?: string[];
}

interface RecommendationCandidate {
  game: Game;
  aggregateScore: number;
  intentScore?: number;
  preferenceScore?: number;
  popularityScore?: number;
  retrievalScore?: number;
  matchedSections: string[];
  snippets: string[];
}

interface RecommendationIntent {
  requestedPlayerCount?: number;
  requestedPlayerRangeMin?: number;
  requestedPlayerRangeMax?: number;
  maxPlaytime?: number;
  minComplexity?: number;
  maxComplexity?: number;
  maxAgeRating?: number;
  desiredTags: string[];
  searchTerms: string[];
}

interface RecommendationHighlight {
  label: string;
  text: string;
}

interface LLMResponseStreamCallbacks {
  onReplyUpdate?: (text: string) => void;
}

interface PreparedLlmTurn {
  currentUserQuestion: string;
  retrievedRulesContext: string;
  retrievedRuleCitations: InternalWikiCitation[];
  recommendationContext: string;
  recommendationIntent: RecommendationIntent;
  recommendationCandidates: RecommendationCandidate[];
  excludedRecommendationNames: string[];
  messages: { role: string; content: string }[];
  directAnswer?: string;
}

const RECOMMENDATION_INTERNAL_LABEL_PATTERN = /(推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条|人数词条|时长词条|难度词条|场景词条|互动词条|机制词条|氛围词条|检索别名|如果用户想找|用户可能会这样描述它)/;
const GENERIC_RECOMMENDATION_HEADING_PATTERN = /(这局为什么会中它|为什么适合你们这局|为什么选中它|为什么选它|最抓人的点|再补一个爽点|爽点是什么|推荐理由|核心亮点|好玩点|更容易上头的地方)/;

function sanitizeRecommendationEvidenceText(text: string): string {
  if (!text) {
    return '';
  }

  const lines = text
    .replace(/(?:^|\n)\s*(?:#+\s*)?(?:\[|【)?(?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)(?:\]|】)?[:：]?\s*/g, '\n')
    .replace(/\[(?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)\]/g, '')
    .replace(/[【](?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)[】]/g, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !RECOMMENDATION_INTERNAL_LABEL_PATTERN.test(line))
    .filter((line) => (line.match(/\|/g) ?? []).length < 4)
    .filter((line) => !/^如果你(?:们)?有\d+个人以上/.test(line))
    .filter((line) => !/^如果你想来一个上手快/.test(line));

  return lines
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？、,.:;])/g, '$1')
    .trim();
}

function sanitizeRecommendationReplyText(text: string): string {
  return text
    .replace(/按你刚才这句，我先回到当前召回里最稳的一款[:：]?/g, '按你这局的需求，我先给你落一款更贴的：')
    .replace(/我直接给你推荐召回中最稳的这一句[:：]?/g, '这局我先给你落这款：')
    .replace(/当前召回里最稳的一款[:：]?/g, '这局更贴的一款：')
    .replace(/\[(?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)\]/g, '')
    .replace(/[【](?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)[】]/g, '')
    .replace(/(?:^|\n)\s*-\s*(?:人数词条|时长词条|难度词条|场景词条|互动词条|机制词条|氛围词条|检索别名)[:：][^\n]*/g, '')
    .replace(/(?:^|\n)\s*(?:如果用户想找|用户可能会这样描述它)[:：][^\n]*/g, '')
    .replace(/内部识别码[:：]?\s*[a-z0-9-]+/gi, '')
    .replace(/推荐候选池|候选池|召回|recommendation_id|memoryContext|Core Memory|长期记忆|内部使用/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeRefereeReplyText(text: string): string {
  return text
    .replace(/\[证据\d+\]/g, '')
    .replace(/(?:^|\n)\s*关于《[^》]+》[^：:\n]*[：:]\s*/g, '\n')
    .replace(/\n\s*如果是具体的规则细节[\s\S]*$/g, '')
    .replace(/(目标|流程|技巧|提示)\s*[：:]\s*\1\s*[：:]\s*/g, '$1：')
    .replace(/\n{0,2}(?:#+\s*)?(?:参考依据|参考资料|资料来源|证据列表)[:：]?(?:\n|$)[\s\S]*$/g, '')
    .replace(/根据(?:规则|资料|知识库|FAQ)[^，。！？]*[，,:：]\s*/g, '')
    .replace(/(?:这条|上面这条)?(?:常见问题|知识库|规则原文)[^，。！？]*[，,:：]\s*/g, '')
    .replace(/记忆上下文|内部使用|Core Memory/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveModelForMode(mode: ChatMode): string {
  if (!currentConfig) {
    throw new Error('LLM未配置');
  }

  if (!currentConfig.baseUrl.includes('ark.cn-beijing.volces.com')) {
    return currentConfig.model;
  }

  return mode === 'recommendation'
    ? VOLCENGINE_RECOMMENDATION_MODEL
    : VOLCENGINE_REFEREE_MODEL;
}

const TAG_SELLING_ANGLES: Record<string, string> = {
  双人核心: '两个人对坐会一直有来有回，不会变成各玩各的。',
  情侣约会: '它很适合边玩边聊，气氛容易自然升温，不需要硬找话题。',
  朋友聚会: '它很会带场子，熟人局不冷场，新人也能很快跟上。',
  家庭同乐: '家里长辈、新手、常玩的人混在一桌，也不太容易有人掉队。',
  团建破冰: '不熟的人也能很快进入状态，不用先背一堆规则。',
  合作共赢: '重点是一起琢磨和配合，输了也不容易带火气。',
  低冲突友好: '没有那种一上来就互相狠狠干扰的压迫感，玩起来更松弛。',
  阵营推理: '它的爽点就在互相试探和突然翻盘，桌上戏很多。',
  嘴炮谈判: '好玩不只在机制，更多是在互相拿捏、说服和反将一军。',
  高互动对抗: '不是各玩各的那种，你们会一直盯着彼此的动作。',
  烧脑策略: '它不是靠背规则唬人，而是越玩越能感到每一步都有取舍。',
  重策略: '后劲很足，前面埋的小决策，后面都会回来找你算账。',
  轻松休闲: '规则不拧巴，坐下没多久就能进入“开始好玩”的状态。',
  新手友好: '第一次玩也不容易掉队，理解成本很低。',
  欢乐搞笑: '笑点是自然冒出来的，不是那种硬闹腾。',
  安静对弈: '表面安静，实际上每一步都在暗暗较劲，很容易越玩越上头。',
  手牌管理: '手里留什么、什么时候出，都有种小算盘拨得很响的爽感。',
  拼图布局: '最爽的是慢慢把版图拼顺，越摆越有“啊这步真值”的满足感。',
  市场博弈: '你拿什么、给对手留什么，同样重要，拉扯感很足。',
  套装收集: '凑出漂亮连段时会特别有成就感。',
  工人放置: '行动位的先后顺序很关键，卡位和抢节奏都很有味道。',
  卡牌组合: '一旦组合打顺，会有那种连锁反应带来的小高潮。',
};

const TAG_HIGHLIGHT_LABELS: Record<string, string> = {
  双人核心: '两个人有来回',
  情侣约会: '边玩边聊',
  朋友聚会: '气氛升温',
  家庭同乐: '全家能上桌',
  团建破冰: '破冰不尬',
  合作共赢: '一起扛事',
  低冲突友好: '低火药味',
  阵营推理: '互相试探',
  嘴炮谈判: '可以互相拿捏',
  高互动对抗: '全程盯人',
  烧脑策略: '决策有后劲',
  重策略: '越玩越有账',
  轻松休闲: '上手不费劲',
  新手友好: '新手不掉队',
  欢乐搞笑: '笑点自然冒',
  安静对弈: '安静但较劲',
  手牌管理: '手牌有小算盘',
  拼图布局: '越摆越顺',
  市场博弈: '市场会拉扯',
  套装收集: '凑套很上头',
  工人放置: '卡位很有味',
  卡牌组合: '连锁反应',
  骰子驱动: '看脸也刺激',
  拍卖押注: '押注有心跳',
  商业经营: '经营有成就',
  拍卖竞价: '竞价有博弈',
  猜词联想: '脑洞能乱飞',
  大团体适配: '人多不散',
  '5人以上佳': '多人也热',
  '3到4人佳': '三四人刚好',
  '15分钟内': '十几分钟开爽',
  '30分钟内': '半小时成局',
  '60分钟内': '一小时有起伏',
};

const POPULARITY_SIGNAL_TAGS = [
  'BGA Awards Winner',
  'Recommended in real-time',
  'Recommended in turn-based',
  '经典入门',
  '推新神器',
];

function buildRecommendationIntentHook(intent: RecommendationIntent, game: Game, correctionReason?: 'out_of_pool'): string {
  let line = `这局我会先推 **《${game.titleCn}》**。`;

  if (intent.desiredTags.includes('情侣约会') || intent.desiredTags.includes('双人核心')) {
    line = `如果你们现在想找一款双人对坐也很有来回感的，我会先推 **《${game.titleCn}》**。`;
  } else if (intent.desiredTags.includes('家庭同乐')) {
    line = `如果这局是家人同桌、想玩得热闹又别太累，我会先推 **《${game.titleCn}》**。`;
  } else if (intent.desiredTags.includes('朋友聚会') || intent.desiredTags.includes('团建破冰')) {
    line = `如果这局想很快把气氛带起来，我会先推 **《${game.titleCn}》**。`;
  } else if (intent.desiredTags.includes('合作共赢') || intent.desiredTags.includes('低冲突友好')) {
    line = `如果你们想玩得轻松一点、但又别太平，我会先推 **《${game.titleCn}》**。`;
  } else if (intent.desiredTags.includes('烧脑策略') || intent.desiredTags.includes('重策略')) {
    line = `如果你想找一款规则不压人、但决策很有味道的，我会先推 **《${game.titleCn}》**。`;
  } else if (typeof intent.requestedPlayerCount === 'number') {
    line = `按你们这局 **${intent.requestedPlayerCount}人** 的需求，我会先推 **《${game.titleCn}》**。`;
  } else if (
    typeof intent.requestedPlayerRangeMin === 'number'
    && typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    line = `按你们这局 **${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax}人** 都能顺开起来的需求，我会先推 **《${game.titleCn}》**。`;
  }

  if (correctionReason === 'out_of_pool') {
    return `如果只看你们这局真正想要的感觉，我还是会把 **《${game.titleCn}》** 放在前面。`;
  }

  return line;
}

function buildRecommendationCorePitch(candidate: RecommendationCandidate): string {
  const snippet = candidate.snippets.find((value) => value && value.trim().length > 0) || '';
  const normalizedSnippet = sanitizeRecommendationEvidenceText(snippet).replace(/^["'“”]+|["'“”]+$/g, '').trim();
  const normalizedOneLiner = sanitizeRecommendationEvidenceText(candidate.game.oneLiner)
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  const pitch = normalizedSnippet && !RECOMMENDATION_INTERNAL_LABEL_PATTERN.test(normalizedSnippet)
    ? normalizedSnippet
    : normalizedOneLiner;
  return pitch.endsWith('。') ? pitch : `${pitch}。`;
}

function buildRecommendationSellingHighlights(game: Game, intent: RecommendationIntent): RecommendationHighlight[] {
  const orderedTags = uniqueStrings([
    ...intent.desiredTags,
    ...getStructuredRecommendationTags(game),
    ...game.tags,
  ]);

  return orderedTags
    .map((tag) => {
      const text = TAG_SELLING_ANGLES[tag];
      if (!text) {
        return undefined;
      }

      return {
        label: TAG_HIGHLIGHT_LABELS[tag] ?? tag,
        text,
      };
    })
    .filter((value): value is RecommendationHighlight => Boolean(value))
    .slice(0, 2);
}

function buildRecommendationCoreHighlightLabel(game: Game, intent: RecommendationIntent): string {
  const orderedTags = uniqueStrings([
    ...intent.desiredTags,
    ...getStructuredRecommendationTags(game),
    ...game.tags,
  ]);
  const matchingTag = orderedTags.find((tag) => TAG_HIGHLIGHT_LABELS[tag]);

  return matchingTag ? TAG_HIGHLIGHT_LABELS[matchingTag] : '玩起来有画面';
}

function buildRecommendationPlayerFitLine(game: Game, intent: RecommendationIntent): string | null {
  if (intent.desiredTags.includes('双人核心') || intent.desiredTags.includes('情侣约会')) {
    return '你们两个人开它正舒服，来回拉扯会特别明显，不会有谁在旁边干等。';
  }

  if (
    typeof intent.requestedPlayerRangeMin === 'number'
    && typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    return `你们这个人数区间它都撑得住，**${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax}人** 开起来不会挤，也不会空。`;
  }

  if (typeof intent.requestedPlayerCount === 'number') {
    if (game.bestPlayerCount?.includes(intent.requestedPlayerCount)) {
      return `而且 **${intent.requestedPlayerCount}人** 基本就在它的舒服区间，节奏最容易出来。`;
    }

    return `你们这局 **${intent.requestedPlayerCount}人** 也能顺顺地开起来，不容易有人掉线。`;
  }

  if (intent.desiredTags.includes('朋友聚会') || intent.desiredTags.includes('团建破冰')) {
    return '它对人数包容度不错，桌上人多时也能把节奏带起来。';
  }

  return null;
}

function buildRecommendationPlayerFitLabel(intent: RecommendationIntent): string {
  if (intent.desiredTags.includes('双人核心') || intent.desiredTags.includes('情侣约会')) {
    return '两个人有来回';
  }

  if (
    typeof intent.requestedPlayerRangeMin === 'number'
    && typeof intent.requestedPlayerRangeMax === 'number'
  ) {
    return `${intent.requestedPlayerRangeMin}-${intent.requestedPlayerRangeMax}人都能接住`;
  }

  if (typeof intent.requestedPlayerCount === 'number') {
    return `${intent.requestedPlayerCount}人不掉线`;
  }

  if (intent.desiredTags.includes('朋友聚会') || intent.desiredTags.includes('团建破冰')) {
    return '人多也能热';
  }

  return '人数不挑剔';
}

function buildRecommendationTempoLine(game: Game): string {
  if (game.playtimeMin <= 15) {
    return `一把大概 **${game.playtimeMin} 分钟**，很容易出现“先来一把试试”然后直接再开第二把。`;
  }

  if (game.playtimeMin <= 30) {
    return `节奏很利落，**${game.playtimeMin} 分钟左右**就能玩出一轮完整起伏，不会拖沓。`;
  }

  if (game.playtimeMin <= 60) {
    return `它不是拖时间那种，**${game.playtimeMin} 分钟左右**刚好能把拉扯感和成就感都玩出来。`;
  }

  return `更适合慢慢经营局势，玩到后面会越来越有“这一把真有内容”的感觉。`;
}

function buildRecommendationTempoLabel(game: Game): string {
  if (game.playtimeMin <= 15) {
    return '一把很快';
  }

  if (game.playtimeMin <= 30) {
    return '节奏利落';
  }

  if (game.playtimeMin <= 60) {
    return '不拖但有起伏';
  }

  return '慢热有料';
}

function buildRecommendationClose(intent: RecommendationIntent): string {
  if (intent.desiredTags.includes('情侣约会') || intent.desiredTags.includes('双人核心')) {
    return '如果你们想要的是“能聊天、也能暗暗较劲”的双人局，这款很容易玩完一把还想马上再来。';
  }

  if (intent.desiredTags.includes('家庭同乐')) {
    return '如果你们现在要的是一款能把不同水平的人都拢在一桌、还不容易冷场的，它会很稳。';
  }

  if (intent.desiredTags.includes('朋友聚会') || intent.desiredTags.includes('团建破冰')) {
    return '如果你们现在想要的是不费解释、又能很快把桌上情绪带起来的桌游，它会很会带节奏。';
  }

  if (intent.desiredTags.includes('烧脑策略') || intent.desiredTags.includes('重策略')) {
    return '如果你想要的是那种规则不压人、但每一步都真有味道的局，它会越玩越顺手。';
  }

  return '如果你们想找一款很快就能进入状态、而且越玩越有味道的桌游，它会是个很稳的选择。';
}

function uniqueRecommendationHighlights(highlights: Array<RecommendationHighlight | undefined>): RecommendationHighlight[] {
  const seenLabels = new Set<string>();
  const seenTexts = new Set<string>();
  const results: RecommendationHighlight[] = [];

  for (const highlight of highlights) {
    if (!highlight?.label || !highlight.text) {
      continue;
    }

    const normalizedLabel = normalizeCompactUserInput(highlight.label);
    const normalizedText = normalizeCompactUserInput(highlight.text)
      .replace(/[。！？!?,，、]/g, '');
    if (!normalizedLabel || !normalizedText || seenLabels.has(normalizedLabel) || seenTexts.has(normalizedText)) {
      continue;
    }

    seenLabels.add(normalizedLabel);
    seenTexts.add(normalizedText);
    results.push(highlight);
  }

  return results;
}

function formatRecommendationHighlight(highlight: RecommendationHighlight): string {
  return `- **${highlight.label}**：${highlight.text}`;
}

function calculatePopularityProxy(game: Game): number {
  let score = 0;

  const bgaPopularitySignal = getBgaPopularitySignal(game.id);
  if (bgaPopularitySignal) {
    score += bgaPopularitySignal.score;
  }

  if (game.knowledgeTier !== 'catalog') {
    score += 0.04;
  }

  if (game.bestPlayerCount && game.bestPlayerCount.length > 0) {
    score += 0.03;
  }

  if (game.bilibiliId || game.tutorialVideoUrl) {
    score += 0.04;
  }

  if (!bgaPopularitySignal && game.tags.some((tag) => POPULARITY_SIGNAL_TAGS.includes(tag))) {
    score += 0.14;
  }

  return score;
}

function calculateLongTermPreferenceBoost(game: Game): number {
  try {
    const memory = getUserMemory();
    const likedTags = memory.likedTags ?? {};
    const preferenceTags = uniqueStrings([
      ...(game.recommendationProfile?.allTags ?? []),
      ...game.tags,
    ]);

    let score = 0;
    for (const tag of preferenceTags) {
      score += Math.min(0.08, (likedTags[tag] ?? 0) * 0.04);
    }

    if (memory.likedGames?.includes(game.id)) {
      score += 0.18;
    }

    if (memory.dislikedGames?.includes(game.id)) {
      score -= 0.3;
    }

    return score;
  } catch {
    return 0;
  }
}

function shouldAvoidAutoSurfacingUnlocalizedGame(game: Game, userQuestion: string): boolean {
  if (hasLocalizedGameTitle(game)) {
    return false;
  }

  return resolveMentionedGameInText(userQuestion)?.id !== game.id;
}

function normalizeRuleSentence(text: string): string {
  return text
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRuleSearchTerms(userQuestion: string): string[] {
  const compactTerms = (userQuestion.match(/[A-Za-z0-9+]+|[\u4e00-\u9fa5]{2,}/g) ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 1);

  if (/平局|平票|并列|同分/.test(userQuestion)) {
    compactTerms.push('平局', '平票', '并列', '同分');
  }
  if (/(怎么赢|如何获胜|怎么才算赢|胜利条件|获胜条件|目标)/.test(userQuestion)) {
    compactTerms.push('获胜', '胜利', '目标');
  }
  if (/(流程|回合|步骤|怎么玩|先干嘛)/.test(userQuestion)) {
    compactTerms.push('流程', '回合', '步骤');
  }
  if (/(注意什么|避坑|提醒|新手|技巧)/.test(userQuestion)) {
    compactTerms.push('注意', '避坑', '提醒', '技巧');
  }
  if (/(能不能|可不可以|可以吗)/.test(userQuestion)) {
    compactTerms.push('可以', '不能');
  }

  return uniqueStrings(compactTerms);
}

function normalizeRulePassage(text: string): string {
  return text
    .replace(/\[证据\d+\][^\n]*\n?/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/^\s*\d+\.\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\bQ:\s*/gi, '')
    .replace(/\bA:\s*/gi, '')
    .replace(/^(目标|流程|技巧|提示|FAQ|常见问题|知识库)\s*[：:]\s*/gim, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitRulePassages(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => block.split(/\n(?=- |\d+\.)/))
    .map((segment) => normalizeRulePassage(segment))
    .filter((segment) => segment.length >= 8);
}

function scoreRulePassage(passage: string, searchTerms: string[]): number {
  const normalizedPassage = passage.toLowerCase();
  let score = 0;

  for (const term of searchTerms) {
    const normalizedTerm = term.toLowerCase();
    if (normalizedPassage.includes(normalizedTerm)) {
      score += normalizedTerm.length >= 3 ? 1.4 : 0.8;
    }
  }

  if (/不能|必须|只有|立即|平局|平票|并列|同分/.test(passage)) {
    score += 0.4;
  }

  return score;
}

function tryBuildDirectRefereeAnswer(userQuestion: string, activeGame?: Game): string | null {
  if (!activeGame) {
    return null;
  }

  const normalizedQuestion = userQuestion.replace(/\s+/g, '');
  const rulesTarget = normalizeRuleSentence(activeGame.rules.target || '');
  const rulesFlow = normalizeRuleSentence(activeGame.rules.flow || '');
  const rulesTips = normalizeRuleSentence(activeGame.rules.tips || '');

  if (/(怎么才算赢|如何获胜|怎么赢|胜利条件|获胜条件)/.test(normalizedQuestion) && rulesTarget) {
    return `**赢法其实就一句话：** ${rulesTarget}`;
  }

  if (/(流程|回合|步骤|先干嘛|怎么玩)/.test(normalizedQuestion) && rulesFlow) {
    return `**大致流程是这样的：** ${rulesFlow}`;
  }

  if (/(注意什么|避坑|新手|提醒)/.test(normalizedQuestion) && rulesTips) {
    return `**新手最容易漏掉的是这几处：** ${rulesTips}`;
  }

  return null;
}

function buildLocalRefereeFallbackReply(
  userQuestion: string,
  activeGame?: Game,
  retrievedRulesContext?: string,
): string {
  if (!activeGame) {
    return '你先告诉我现在在问哪一款桌游，我再按那一套规则给你判。';
  }

  const searchTerms = buildRuleSearchTerms(userQuestion);
  const searchCorpus = [
    retrievedRulesContext?.trim(),
    activeGame.FAQ?.trim(),
    activeGame.knowledgeBase?.trim(),
    activeGame.rules.target?.trim(),
    activeGame.rules.flow?.trim(),
    activeGame.rules.tips?.trim(),
  ].filter(Boolean).join('\n\n');

  const rankedPassages = splitRulePassages(searchCorpus)
    .map((passage) => ({ passage, score: scoreRulePassage(passage, searchTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const lead = /平局|平票|并列|同分/.test(userQuestion)
    ? '**这条先按平局规则来：**'
    : /(能不能|可不可以|可以吗)/.test(userQuestion)
      ? '**这条一般这么判：**'
      : /(流程|回合|步骤|怎么玩|先干嘛)/.test(userQuestion)
        ? '**流程大概是这样：**'
        : '**我先直接说结论：**';

  if (rankedPassages.length > 0) {
    const primary = rankedPassages[0].passage;
    const secondary = rankedPassages
      .slice(1)
      .find((entry) => entry.passage !== primary && entry.passage.length <= 90)
      ?.passage;

    return [
      `${lead} ${primary}`,
      secondary ? `\n\n如果你们桌上现在卡在这一步，顺手再记一句：${secondary}` : undefined,
    ].filter(Boolean).join('');
  }

  const directAnswer = tryBuildDirectRefereeAnswer(userQuestion, activeGame);
  if (directAnswer) {
    return directAnswer;
  }

  return '我现在没在这份本地规则里找到能直接拍板的那一句，所以不想硬判。你把桌面当前触发的具体情况再补一句，我继续替你缩到可执行结论。';
}

const SMALLTALK_ONLY_PATTERN = /^(?:你好|您好|嗨|哈喽|hello|hi|thanks|thankyou|谢谢|谢啦|多谢|好的|好滴|ok|okay|收到|明白|拜拜|再见|哈哈|hhh|嗯嗯|嗯|哦哦)(?:呀|啊|哦|喔|啦|呢|哇)?(?:[，,、 ]*(?:洛思|洛斯|dm))?[!！,.。?？~～]*$/i;
const REFEREE_CONTROL_QUERY_PATTERN = /(换个游戏|换别的游戏|不玩这个了|退出裁判|回到推荐|切回推荐|推荐别的|换个模式)/;
const RECOMMENDATION_META_QUERY_PATTERN = /^(你是谁|你能做什么|你会什么|怎么玩|这个应用是干嘛的|这个产品是干嘛的)[!！,.。?？~～]*$/;

function extractCurrentUserQuestion(rawInput: string): string {
  const markerIndex = rawInput.lastIndexOf(CURRENT_USER_QUESTION_MARKER);
  if (markerIndex === -1) {
    return rawInput.trim();
  }

  return rawInput.slice(markerIndex + CURRENT_USER_QUESTION_MARKER.length).trim();
}

function extractPrimaryRecommendationSignal(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return trimmed;
  }

  const explicitQuotedSignal = trimmed.match(/(?:提示词|关键词|需求|要的是|想找的是)\s*[：:是]\s*[“"']([^”"']+)[”"']/);
  if (explicitQuotedSignal?.[1]) {
    return explicitQuotedSignal[1].trim();
  }

  const correctionPatterns = [
    /不是让你推荐(.+?)(?:吗|么|嘛)[？?，,。!！]?/,
    /我让你推荐(.+?)(?:的|呢|啊|呀|吧|吗|么|嘛)[？?，,。!！]?/,
    /我说的是(.+?)(?:，|,|。|！|!|？|\?)/,
    /我要的是(.+?)(?:，|,|。|！|!|？|\?)/,
    /明明是(.+?)(?:，|,|。|！|!|？|\?)/,
    /明明说了(.+?)(?:，|,|。|！|!|？|\?)/,
  ];

  for (const pattern of correctionPatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return trimmed
    .replace(/怎么给我推荐[\s\S]*$/g, '')
    .replace(/结果(?:却|还)?给我推荐[\s\S]*$/g, '')
    .replace(/你怎么推荐了[\s\S]*$/g, '')
    .replace(/怎么会推荐成[\s\S]*$/g, '')
    .trim() || trimmed;
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

function parseRequestedAgeRating(query: string): number | undefined {
  const trimmed = query.trim();
  if (!trimmed) {
    return undefined;
  }

  const numericMatch = trimmed.match(/(\d+)\s*(?:岁|歲)(?:\s*(?:以上|左右|孩子|小孩|儿童|小朋友))?/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1], 10);
  }

  const cnNumberMap: Record<string, number> = {
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
    '十一': 11,
    '十二': 12,
    '十三': 13,
    '十四': 14,
  };
  const cnMatch = trimmed.match(/(六|七|八|九|十|十一|十二|十三|十四)\s*(?:岁|歲)/);
  return cnMatch ? cnNumberMap[cnMatch[1]] : undefined;
}

function parseRequestedComplexityRange(query: string): { min?: number; max?: number } {
  const trimmed = query.trim();
  if (!trimmed) {
    return {};
  }

  const numericMaxMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以内|以下|之内|以下的|以内的|以下吧|以内吧)/);
  if (numericMaxMatch) {
    return { max: Number.parseFloat(numericMaxMatch[1]) };
  }

  const numericMinMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*(?:以上|往上|以上的)/);
  if (numericMinMatch) {
    return { min: Number.parseFloat(numericMinMatch[1]) };
  }

  const numericRangeMatch = trimmed.match(/(?:复杂度|难度)\s*(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)/);
  if (numericRangeMatch) {
    const min = Number.parseFloat(numericRangeMatch[1]);
    const max = Number.parseFloat(numericRangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return {
        min: Math.min(min, max),
        max: Math.max(min, max),
      };
    }
  }

  if (/(重策|重策略|硬核|烧脑|深度|高复杂度)/.test(trimmed) && !/(别|不要|不想|太)/.test(trimmed)) {
    return { min: 2.8 };
  }

  if (/(中策|中策略|有点策略|有策略但别太重|有策略，但别太重)/.test(trimmed)) {
    return { min: 1.4, max: 2.8 };
  }

  if (/(轻策|轻策略|别太重|不要太重|不想太重|别太烧脑|不要太烧脑|别太复杂|不要太复杂|规则简单|简单|新手|上手快)/.test(trimmed)) {
    return { max: 2.4 };
  }

  return {};
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

function buildRecommendationConversationalReply(userInput: string): string | null {
  const normalized = normalizeCompactUserInput(userInput);

  if (SMALLTALK_ONLY_PATTERN.test(normalized)) {
    if (/(谢谢|谢啦|多谢|thanks|thankyou)/i.test(normalized)) {
      return '不客气。你想让我帮你挑桌游，就直接说人数和想玩的感觉；要是桌上卡规则了，把游戏名和问题丢给我就行。';
    }

    if (/(拜拜|再见)/.test(normalized)) {
      return '行，那你们先玩。后面想组局，或者桌上卡规则了，再来喊我。';
    }

    return '在呢。我能帮你挑适合这局的桌游，也能临场帮你判规则。想组局就告诉我几个人、想玩什么感觉；已经开玩了就直接说游戏名和卡住的地方。';
  }

  if (RECOMMENDATION_META_QUERY_PATTERN.test(normalized)) {
    return '我是洛思，平时就干两件事：帮你把这局桌游挑准，或者在桌上卡规则的时候直接给结论。你想组局就告诉我人数和想玩的感觉；已经开玩了就把游戏名和问题甩给我。';
  }

  return null;
}

function getStructuredRecommendationTags(game: Game): string[] {
  return game.recommendationProfile?.allTags ?? game.tags;
}

function getStructuredSearchTerms(game: Game): string[] {
  return game.recommendationProfile?.searchTerms ?? game.tags;
}

function buildGameKeywordSurface(game: Game): string {
  return normalizeCompactUserInput([
    game.titleCn,
    game.titleEn,
    game.oneLiner,
    ...getStructuredRecommendationTags(game),
    ...getStructuredSearchTerms(game),
    ...game.tags,
    game.knowledgeBase ?? '',
    game.FAQ ?? '',
  ].join(' '));
}

function countGameConceptMatches(game: Game, concepts: string[]): number {
  const keywordSurface = buildGameKeywordSurface(game);

  return uniqueStrings(concepts)
    .map((concept) => normalizeCompactUserInput(concept))
    .filter((concept) => concept.length >= 2 && keywordSurface.includes(concept))
    .length;
}

function parseRecommendationIntent(query: string): RecommendationIntent {
  const desiredTags: string[] = [];
  const searchTerms: string[] = [];
  const normalizedQuery = extractPrimaryRecommendationSignal(query);
  const playerRange = parseRequestedPlayerRange(normalizedQuery);
  const complexityRange = parseRequestedComplexityRange(normalizedQuery);
  const maxAgeRating = parseRequestedAgeRating(normalizedQuery);

  const addIntent = (tags: string[], terms: string[]) => {
    desiredTags.push(...tags);
    searchTerms.push(...terms);
  };

  if (/情侣|约会/.test(normalizedQuery)) {
    addIntent(['双人核心', '情侣约会'], ['双人', '两人', '情侣', '约会']);
  }
  if (/双人|两人|2人/.test(normalizedQuery)) {
    addIntent(['双人核心'], ['双人', '两人', '2人']);
  }
  if (/聚会|人多|热闹|团建/.test(normalizedQuery)) {
    addIntent(['朋友聚会'], ['聚会', '人多', '热闹', '多人']);
  }
  if (/家庭|家人|合家欢/.test(normalizedQuery)) {
    addIntent(['家庭同乐', '轻松休闲'], ['家庭', '家人', '合家欢', '家庭局']);
  }
  if (/亲子|孩子|小朋友|儿童|带娃/.test(normalizedQuery)) {
    addIntent(['家庭同乐', '低冲突友好', '新手友好'], ['亲子', '孩子', '小朋友', '儿童', '低冲突', '好教']);
  }
  if (/破冰|聊天|说话|表达/.test(normalizedQuery)) {
    addIntent(['团建破冰', '猜词联想'], ['破冰', '聊天', '说话', '表达']);
  }
  if (/合作|协作|友好/.test(normalizedQuery) || /不想.*互相伤害/.test(normalizedQuery)) {
    addIntent(['合作共赢', '低冲突友好'], ['合作', '不互相伤害', '友好']);
  }
  if (/阵营|身份|推理/.test(normalizedQuery)) {
    addIntent(['阵营推理'], ['阵营', '身份', '推理']);
  }
  if (/嘴炮|谈判/.test(normalizedQuery)) {
    addIntent(['嘴炮谈判'], ['嘴炮', '谈判']);
  }
  if (/对抗|博弈/.test(normalizedQuery)) {
    addIntent(['高互动对抗'], ['对抗', '博弈']);
  }
  if (/策略|烧脑|重策/.test(normalizedQuery)) {
    addIntent(['烧脑策略', '重策略'], ['策略', '烧脑', '重策']);
  }
  if (/轻松|休闲|简单|上手快|新手/.test(normalizedQuery)) {
    addIntent(['轻松休闲', '新手友好'], ['轻松', '休闲', '上手快', '新手']);
  }
  if (/搞笑|欢乐/.test(normalizedQuery)) {
    addIntent(['欢乐搞笑', '朋友聚会'], ['搞笑', '欢乐']);
  }
  if (/经典|耐玩|常青|入门砖|口碑|老牌/.test(normalizedQuery)) {
    searchTerms.push('经典', '耐玩', '常青', '经典入门', '入门砖', '德式经典', '老牌德式', '口碑');
  }
  if (/骰子|掷骰|投骰/.test(normalizedQuery)) {
    addIntent(['骰子驱动'], ['骰子', '掷骰', '投骰']);
  }
  if (/运气|看脸|豪赌|押注|赌运|赌狗/.test(normalizedQuery)) {
    addIntent(['拍卖押注'], ['运气', '看脸', '豪赌', '押注']);
  }
  if (/投资|股价|股份|分红|市场波动|资本|回报|炒盘|炒股/.test(normalizedQuery)) {
    addIntent(
      ['商业经营', '拍卖竞价'],
      ['投资', '股价', '股份', '分红', '市场', '市场波动', '拍卖', '竞价', '回报'],
    );
  } else if (/经营|经商|赚钱/.test(normalizedQuery)) {
    addIntent(['商业经营'], ['经营', '经商', '赚钱']);
  }
  if (/引擎|构筑|combo|连段/.test(normalizedQuery)) {
    addIntent(['引擎构筑'], ['引擎', '引擎构筑', '构筑', 'combo', '连段']);
  }
  if (/拼图|版图|板块|铺砖|摆放/.test(normalizedQuery)) {
    addIntent(['拼图布局'], ['拼图', '版图', '板块', '铺砖', '摆放']);
  }
  if (/工人|工放|行动位|卡位/.test(normalizedQuery)) {
    addIntent(['工人放置'], ['工人放置', '工放', '行动位', '卡位']);
  }
  if (/手牌|出牌|牌序/.test(normalizedQuery)) {
    addIntent(['手牌管理'], ['手牌', '出牌', '牌序']);
  }
  if (/抽象|棋类|对弈/.test(normalizedQuery)) {
    addIntent(['抽象对战', '安静对弈'], ['抽象', '棋类', '对弈']);
  }
  if (/路线|线路|网络|连线/.test(normalizedQuery)) {
    addIntent(['路线规划'], ['路线', '线路', '网络', '连线']);
  }
  if (/卡组|牌库|deck/.test(normalizedQuery)) {
    addIntent(['卡组构筑'], ['卡组', '牌库', 'deck']);
  }
  if (/竞速|赛跑|冲刺/.test(normalizedQuery)) {
    addIntent(['竞速赛跑'], ['竞速', '赛跑', '冲刺']);
  }
  if (/吃墩|叫牌/.test(normalizedQuery)) {
    addIntent(['吃墩叫牌'], ['吃墩', '叫牌']);
  }
  if (/收集|凑套|套装/.test(normalizedQuery)) {
    addIntent(['收集组合'], ['收集', '凑套', '套装']);
  }

  const maxPlaytime = parseRequestedMaxPlaytime(normalizedQuery);
  if (typeof maxPlaytime === 'number') {
    if (maxPlaytime <= 15) {
      addIntent(['15分钟内'], ['15分钟内', '十几分钟']);
    } else if (maxPlaytime <= 30) {
      addIntent(['30分钟内'], ['30分钟内', '半小时内', '半小时']);
    } else if (maxPlaytime <= 60) {
      addIntent(['60分钟内'], ['60分钟内', '一小时内']);
    }
  }

  if (typeof maxAgeRating === 'number') {
    searchTerms.push(`${maxAgeRating}岁可玩`, `${maxAgeRating}岁以上`, '适合年龄');
  }

  if (typeof complexityRange.max === 'number') {
    addIntent(['新手友好', '轻松休闲'], ['低复杂度', '容易教', '上手快']);
  }
  if (typeof complexityRange.min === 'number') {
    addIntent(['烧脑策略', '重策略'], ['策略深度', '烧脑', '有深度']);
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
    const requestedPlayerCount = parseRequestedPlayerCount(normalizedQuery);
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
        : parseRequestedPlayerCount(normalizedQuery),
    requestedPlayerRangeMin: playerRange.min,
    requestedPlayerRangeMax: playerRange.max,
    maxPlaytime,
    minComplexity: complexityRange.min,
    maxComplexity: complexityRange.max,
    maxAgeRating,
    desiredTags: uniqueStrings(desiredTags),
    searchTerms: uniqueStrings(searchTerms),
  };
}

function calculateRecommendationIntentScore(game: Game, intent: RecommendationIntent): number {
  const profileTags = getStructuredRecommendationTags(game);
  const hasProfileTag = (tag: string) => profileTags.includes(tag);
  const wantsFamilyPlay = intent.desiredTags.includes('家庭同乐');
  const wantsLowConflict = intent.desiredTags.includes('低冲突友好');
  const wantsNewbieFriendly = intent.desiredTags.includes('新手友好');
  const mechanicIntentTags = [
    '骰子驱动',
    '拍卖押注',
    '商业经营',
    '拍卖竞价',
    '引擎构筑',
    '拼图布局',
    '工人放置',
    '手牌管理',
    '抽象对战',
    '路线规划',
    '卡组构筑',
    '竞速赛跑',
    '吃墩叫牌',
    '收集组合',
  ];
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

  if (typeof intent.minComplexity === 'number') {
    if (game.complexity >= intent.minComplexity) {
      score += 0.25;
    } else {
      score -= 0.4;
    }
  }

  if (typeof intent.maxComplexity === 'number') {
    if (game.complexity <= intent.maxComplexity) {
      score += 0.2;
    } else {
      score -= 0.4;
    }
  }

  if (typeof intent.maxAgeRating === 'number') {
    if (game.ageRating <= intent.maxAgeRating) {
      score += 0.25;
    } else {
      score -= 0.55;
    }
  }

  if (intent.desiredTags.includes('重策略') && game.complexity >= 2.8) {
    score += 0.25;
  }
  if (intent.desiredTags.includes('新手友好') && game.complexity <= 1.5) {
    score += 0.25;
  }

  for (const tag of mechanicIntentTags) {
    if (!intent.desiredTags.includes(tag)) {
      continue;
    }
    score += hasProfileTag(tag) ? 0.75 : -0.22;
  }

  if (intent.desiredTags.includes('骰子驱动')) {
    if (hasProfileTag('手速反应')) {
      score -= 0.4;
    }
    if (hasProfileTag('拍卖竞价') && !hasProfileTag('骰子驱动')) {
      score -= 0.3;
    }
  }

  if (intent.desiredTags.includes('商业经营') || intent.desiredTags.includes('拍卖竞价')) {
    const marketConceptMatchCount = countGameConceptMatches(game, [
      '股份',
      '分红',
      '股价',
      '市场',
      '市场波动',
      '拍卖',
      '竞价',
      '竞拍',
      '投资',
      '回报',
    ]);

    if (marketConceptMatchCount >= 3) {
      score += 0.9;
    } else if (marketConceptMatchCount >= 1) {
      score += 0.3;
    } else {
      score -= 0.45;
    }
  }

  if (wantsFamilyPlay) {
    if (hasProfileTag('家庭同乐')) {
      score += 0.8;
    }
    if (hasProfileTag('低冲突友好')) {
      score += 0.35;
    }
    if (wantsNewbieFriendly && hasProfileTag('新手友好')) {
      score += 0.2;
    }
    if (game.ageRating <= 8) {
      score += 0.25;
    } else if (game.ageRating >= 12) {
      score -= 0.65;
    }
    if (hasProfileTag('阵营推理') || hasProfileTag('嘴炮谈判')) {
      score -= 0.9;
    }
    if (hasProfileTag('高互动对抗')) {
      score -= wantsLowConflict ? 0.7 : 0.35;
    }
  } else if (wantsLowConflict && hasProfileTag('高互动对抗')) {
    score -= 0.45;
  }

  const matchedConceptCount = uniqueStrings([
    ...intent.desiredTags,
    ...intent.searchTerms,
  ]).filter((term) => {
    const normalizedTerm = normalizeCompactUserInput(term);
    return normalizedTerm.length >= 2 && buildGameKeywordSurface(game).includes(normalizedTerm);
  }).length;
  score += matchedConceptCount * 0.08;

  return score;
}

function buildRecommendationRankSignals(game: Game, intent: RecommendationIntent, retrievalScore: number = 0) {
  const intentScore = calculateRecommendationIntentScore(game, intent);
  const preferenceScore = calculateLongTermPreferenceBoost(game);
  const popularityScore = calculatePopularityProxy(game);

  return {
    intentScore,
    preferenceScore,
    popularityScore,
    retrievalScore,
    aggregateScore: intentScore + preferenceScore + popularityScore + retrievalScore,
  };
}

function compareRecommendationCandidates(
  left: RecommendationCandidate,
  right: RecommendationCandidate,
  intent: RecommendationIntent,
): number {
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

  const leftIntentScore = left.intentScore ?? 0;
  const rightIntentScore = right.intentScore ?? 0;
  if (leftIntentScore !== rightIntentScore) {
    return rightIntentScore - leftIntentScore;
  }

  const leftPreferenceScore = left.preferenceScore ?? 0;
  const rightPreferenceScore = right.preferenceScore ?? 0;
  if (leftPreferenceScore !== rightPreferenceScore) {
    return rightPreferenceScore - leftPreferenceScore;
  }

  const leftPopularityScore = left.popularityScore ?? 0;
  const rightPopularityScore = right.popularityScore ?? 0;
  if (leftPopularityScore !== rightPopularityScore) {
    return rightPopularityScore - leftPopularityScore;
  }

  const leftRetrievalScore = left.retrievalScore ?? 0;
  const rightRetrievalScore = right.retrievalScore ?? 0;
  if (leftRetrievalScore !== rightRetrievalScore) {
    return rightRetrievalScore - leftRetrievalScore;
  }

  return right.aggregateScore - left.aggregateScore;
}

function hasStrictRecommendationConstraint(intent: RecommendationIntent): boolean {
  return typeof intent.requestedPlayerCount === 'number'
    || typeof intent.requestedPlayerRangeMin === 'number'
    || typeof intent.requestedPlayerRangeMax === 'number'
    || typeof intent.maxPlaytime === 'number'
    || typeof intent.minComplexity === 'number'
    || typeof intent.maxComplexity === 'number'
    || typeof intent.maxAgeRating === 'number';
}

function isGameCompatibleWithIntent(game: Game, intent: RecommendationIntent): boolean {
  const structuredTags = getStructuredRecommendationTags(game);
  const wantsFamilyPlay = intent.desiredTags.includes('家庭同乐');
  const wantsLowConflict = intent.desiredTags.includes('低冲突友好');

  if (typeof intent.maxPlaytime === 'number' && game.playtimeMin > intent.maxPlaytime) {
    return false;
  }

  if (typeof intent.minComplexity === 'number' && game.complexity < intent.minComplexity) {
    return false;
  }

  if (typeof intent.maxComplexity === 'number' && game.complexity > intent.maxComplexity) {
    return false;
  }

  if (typeof intent.maxAgeRating === 'number' && game.ageRating > intent.maxAgeRating) {
    return false;
  }

  if (wantsFamilyPlay) {
    if (game.ageRating > 10) {
      return false;
    }
    if (structuredTags.includes('阵营推理') || structuredTags.includes('嘴炮谈判')) {
      return false;
    }
    if (wantsLowConflict && structuredTags.includes('高互动对抗')) {
      return false;
    }
  }

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

function buildLocalRecommendationCandidates(
  query: string,
  intent: RecommendationIntent,
  excludeIds: string[] = [],
): RecommendationCandidate[] {
  const normalizedQuery = normalizeCompactUserInput(extractPrimaryRecommendationSignal(query));
  const sparseIntent =
    !intent.maxPlaytime &&
    intent.desiredTags.filter((tag) => !['双人核心', '3到4人佳', '5人以上佳', '大团体适配'].includes(tag)).length === 0;

  const candidates = GAME_DATABASE
    .filter((game) => !excludeIds.includes(game.id))
    .filter((game) => isGameCompatibleWithIntent(game, intent))
    .map((game) => {
      const structuredTags = getStructuredRecommendationTags(game);
      const searchTerms = getStructuredSearchTerms(game);
      const keywordSurface = buildGameKeywordSurface(game);
      const rankSignals = buildRecommendationRankSignals(game, intent);
      let aggregateScore = rankSignals.aggregateScore;

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

      const matchedIntentTerms = uniqueStrings([
        ...intent.desiredTags,
        ...intent.searchTerms,
      ]).filter((term) => {
        const normalizedTerm = normalizeCompactUserInput(term);
        return normalizedTerm.length >= 2 && keywordSurface.includes(normalizedTerm);
      });

      aggregateScore += matchedIntentTerms.length * 0.08;

      if (game.knowledgeTier !== 'catalog') {
        aggregateScore += 0.08;
      }

      if (shouldAvoidAutoSurfacingUnlocalizedGame(game, query)) {
        aggregateScore -= 0.45;
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
        intentScore: rankSignals.intentScore,
        preferenceScore: rankSignals.preferenceScore,
        popularityScore: rankSignals.popularityScore,
        retrievalScore: 0,
        matchedSections,
        snippets: [game.oneLiner],
      };
    })
    .sort((left, right) => compareRecommendationCandidates(left, right, intent));

  return candidates.slice(0, 8);
}

function buildCandidateFallbackReply(
  candidate: RecommendationCandidate,
  intent: RecommendationIntent,
  correctionReason?: 'out_of_pool',
): string {
  const game = candidate.game;
  const lead = buildRecommendationIntentHook(intent, game, correctionReason);
  const corePitch = buildRecommendationCorePitch(candidate);
  const sellingHighlights = buildRecommendationSellingHighlights(game, intent);
  const playerFitLine = buildRecommendationPlayerFitLine(game, intent);
  const tempoLine = buildRecommendationTempoLine(game);
  const close = buildRecommendationClose(intent);
  const hasPlayerConstraint =
    typeof intent.requestedPlayerCount === 'number'
    || typeof intent.requestedPlayerRangeMin === 'number'
    || typeof intent.requestedPlayerRangeMax === 'number';

  const coreHighlight: RecommendationHighlight | undefined = corePitch
    ? {
      label: buildRecommendationCoreHighlightLabel(game, intent),
      text: corePitch,
    }
    : undefined;
  const playerHighlight: RecommendationHighlight | undefined = playerFitLine
    ? {
      label: buildRecommendationPlayerFitLabel(intent),
      text: playerFitLine,
    }
    : undefined;
  const tempoHighlight: RecommendationHighlight | undefined = tempoLine
    ? {
      label: buildRecommendationTempoLabel(game),
      text: tempoLine,
    }
    : undefined;

  const highlightOrder = hasPlayerConstraint
    ? [coreHighlight, playerHighlight, ...sellingHighlights, tempoHighlight]
    : [coreHighlight, ...sellingHighlights, playerHighlight, tempoHighlight];

  const bulletLines = uniqueRecommendationHighlights(highlightOrder)
    .slice(0, 3)
    .map(formatRecommendationHighlight);

  return [
    lead,
    '',
    ...bulletLines,
    '',
    close,
  ].filter(Boolean).join('\n');
}

function formatRecommendationContext(
  candidates: RecommendationCandidate[],
  intent: RecommendationIntent = { desiredTags: [], searchTerms: [] },
): string {
  if (candidates.length === 0) {
    return '';
  }
  return buildInternalRecommendationContext(
    candidates.map((candidate) => candidate.game),
    intent,
  );
}

function shouldForceLocalRecommendationRewrite(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return false;
  }

  const bulletCount = (text.match(/(?:^|\n)-\s+\*\*/g) ?? []).length;
  if (bulletCount === 0 || (bulletCount > 0 && bulletCount < 2)) {
    return true;
  }

  if (/它最抓人的地方是[:：]/.test(compact) && bulletCount < 2) {
    return true;
  }

  if (GENERIC_RECOMMENDATION_HEADING_PATTERN.test(compact)) {
    return true;
  }

  if (/(?:\[|【)(?:推荐摘要|适合场景|结构化词条|推荐检索语料|推荐词条)(?:\]|】)/.test(compact)) {
    return true;
  }

  if (RECOMMENDATION_INTERNAL_LABEL_PATTERN.test(compact)) {
    return true;
  }

  return (compact.match(/\|/g) ?? []).length >= 6;
}

function extractMentionedGamesFromRecommendationText(text: string): Game[] {
  const matches = Array.from(text.matchAll(/[《【](.*?)[》】]/g))
    .map((match) => match[1].replace(/[*_]/g, '').trim())
    .filter(Boolean);

  const seenIds = new Set<string>();
  const detectedGames: Game[] = [];

  for (const name of matches) {
    const game = GAME_DATABASE.find((item) => item.titleCn === name || item.titleEn === name);
    if (!game || seenIds.has(game.id)) {
      continue;
    }

    seenIds.add(game.id);
    detectedGames.push(game);
  }

  return detectedGames;
}

function shouldForceFallbackCardRewrite(text: string, mentionedGames: Game[]): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();

  if (!compact) {
    return false;
  }

  if (mentionedGames.length > 1) {
    return true;
  }

  if ((compact.match(/《[^》]+》/g) ?? []).length > 1) {
    return true;
  }

  if (/(?:^|\n)\s*(?:#+\s*)?\d+\.\s+\*\*/m.test(text)) {
    return true;
  }

  if (/(?:最终推荐|如果你们喜欢|如果倾向|选最省心的)/.test(compact) && mentionedGames.length !== 1) {
    return true;
  }

  return false;
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
    - 默认先写自然的人话，不要一上来就列清单。
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
    9. 你要先判断用户此刻真正想要的乐趣：是热闹、对抗、暧昧、烧脑、轻松、还是有来有回的互动，再围绕这个意图去推荐。
    10. 你的话术要像真的 DM 在把这款游戏推销出去：先点中需求，再把这款游戏“玩起来会发生什么”讲得有画面。
    11. 不要把回复写成数据库说明书。除非用户明确追问参数，否则不要机械复述人数、时长、标签；这些信息只能当辅助，不要喧宾夺主。
    12. 你的话术要自然、轻松、带一点懂行朋友的幽默感，但不要油腻，不要冒出“召回”“候选池”“记忆上下文”“内部识别码”这类内部词。
    13. 推荐文案默认写成：**1句自然点名 + 2到3个很短的无序列表 + 1句收尾推动**。
    14. 每个 bullet 的 **加粗部分必须是具体体验标签**，例如“轻松有趣”“互相捉弄”“把气氛搞热”“非常烧脑”“逻辑严密”“新手不掉队”。不要写“为什么选它”“推荐理由”“核心亮点”“最抓人的点”“再补一个爽点”这种通用栏目名。
    15. 只抓当前这局最 relevant 的那个体验去讲：它怎么适合现在这群人、这股气氛、这个时长，而不是把资料卡全背一遍。
    16. 除非用户在问参数，否则不要大段重复人数、时长；真的要提，也只点到为止，塞进一句话里。
    17. 如果用户明确想看“几点亮点”，你可以只围绕这一款游戏列 **2 到 3 个很短的点**；每个点的标题都要像这款游戏自己的卖点，不要像模板字段。
    18. 绝对不要输出模型自己的思考过程、犹豫过程、候选比较过程；只给用户最终那版能直接看的推荐话术。

      【回复格式要求】：
      - 请务必使用 ** Markdown ** 格式。
      - 游戏名必须使用 **书名号《》** 并加粗。例如：**《卡坦岛》**。
      - 第一行可以直接点名推荐，但不要像播报卡片。
      - 默认就用 **2到3个短 bullet** 来讲这款游戏最值得玩的点，每个 bullet 的 **加粗小标题** 必须是具体体验标签，不是栏目名。
      - 禁止使用这些小标题：**这局为什么会中它**、**为什么适合你们这局**、**为什么选它**、**推荐理由**、**核心亮点**、**最抓人的点**、**再补一个爽点**、**爽点是什么**。
      - bullet 只围绕这一款游戏展开，不要在同一轮里同时推荐多款游戏。
      - 收尾用一句自然的推动，不要再复述前文。

      【兜底策略（重要）】：
      如果用户明确询问或要求推荐一款具体的游戏，且该游戏不在上述我们的游戏库列表中，或者本地候选明显不匹配：
      1. 请主要依赖你自身的知识库储备来详细科普或回答，向玩家介绍该游戏的规则、特色和玩法。
      2. 只有当你的预训练数据中完全没有任何关于这款游戏的记录时，才可以回答不知道，绝对不要凭空捏造。
      3. 在返回的 JSON 中，加入字段 "unknown_target_game": "用户询问的游戏名称"。
      4. 这类回答的 recommendation_id 必须为 null。

      【输出格式规则 - 重要】：
      - 如果你决定推荐一款本地库存在的游戏，返回严格 JSON：
      {
        "reply": "致用户的 Markdown 文本。格式默认是：1句自然点名 + 2到3个短 bullet（加粗处写具体体验标签）+ 1句自然收尾。",
        "recommendation_name": "游戏完整中文名",
        "recommendation_id": "该游戏的ID"
      }

      - 如果用户询问了本地库不存在的游戏：
      {
        "reply": "你的回复内容（基于自身知识科普或承认不知道）",
        "recommendation_id": null,
        "unknown_target_game": "用户询问的具体游戏名"
      }

      - 如果只是普通聊天：
      {
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
      【内部规则资料】：
      这些资料只用于你自己判断，不要把 [证据1]、章节名、FAQ 标题、参考依据之类的内部结构露给用户。
      如果当前资料没有直接写明，就明确说“这条我不敢瞎判”，不要装作规则原文已经写了。
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
    3. ** 请直接回答问题 **，先给结论，再把关键规则自然解释出来。不要说“根据规则...”“参考依据...”。
    4. 遇到资料未提及的细节，不要假装规则里明确写了；可以给出谨慎推断，但要说清楚是推断。
    5. 解释规则要通俗易懂，像朋友交流一样自然，不要像在念规则说明卡。
    6. 不要把知识库字段名、标题名、问答标签原样吐给用户。禁止出现“目标：目标：”“FAQ：”“常见问题：”这种字段感很重的说法。
    7. 如果本地资料里已经有答案，就请你把它消化成一段完整结论，而不是把资料原句整块搬出来。
      
      【回复格式要求】：
      - 必须使用 ** Markdown ** 格式。
      - 关键规则点、数字、判定结果可以 **加粗**，但别整段都在强调。
      - 默认先用一两句人话讲清结论；只有真的涉及步骤、计分拆解、多条件分支时再用列表。
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
  _citations: InternalWikiCitation[],
): string {
  return sanitizeRefereeReplyText(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？、,.:;])/g, '$1')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 调用真实LLM API
async function callLLMAPI(messages: { role: string; content: string }[], mode: ChatMode): Promise<string> {
  if (!currentConfig) {
    throw new Error('LLM未配置');
  }

  try {
    // 根据模式调整 temperature
    const temperature = mode === 'recommendation' ? 0.7 : 0.2;
    const model = resolveModelForMode(mode);

    // 对于支持 JSON mode 的模型（如 OpenAI），可以在这里添加 response_format: { type: "json_object" }
    // 目前通用的做法是在 prompt 里强调返回 JSON
    const body = {
      model,
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
        console.warn('API余额不足，本轮将转本地兜底');
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
    throw error;
  }
}

function decodeEscapedJsonCharacter(char: string): string {
  switch (char) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    case '"':
      return '"';
    case '\\':
      return '\\';
    case '/':
      return '/';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    default:
      return char;
  }
}

function extractPartialJsonStringField(rawText: string, fieldName: string): string {
  const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`);
  const match = fieldPattern.exec(rawText);
  if (!match) {
    return '';
  }

  let index = match.index + match[0].length;
  let output = '';
  let isEscaping = false;

  while (index < rawText.length) {
    const current = rawText[index];

    if (isEscaping) {
      if (current === 'u') {
        const unicodeDigits = rawText.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          output += String.fromCharCode(Number.parseInt(unicodeDigits, 16));
          index += 5;
          isEscaping = false;
          continue;
        }
        return output;
      }

      output += decodeEscapedJsonCharacter(current);
      isEscaping = false;
      index += 1;
      continue;
    }

    if (current === '\\') {
      isEscaping = true;
      index += 1;
      continue;
    }

    if (current === '"') {
      return output;
    }

    output += current;
    index += 1;
  }

  return output;
}

function extractStreamingReplyPreview(rawText: string): string {
  const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
  if (!cleaned) {
    return '';
  }

  const reply = extractPartialJsonStringField(cleaned, 'reply');
  if (reply) {
    return reply.replace(/\\\*/g, '*');
  }

  return '';
}

function extractAssistantTextFromResponsesPayload(payload: any): string {
  if (typeof payload?.output_text === 'string') {
    return payload.output_text;
  }

  if (!Array.isArray(payload?.output)) {
    return '';
  }

  const parts: string[] = [];
  for (const item of payload.output) {
    if (!item || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentPart of item.content) {
      if (typeof contentPart?.text === 'string') {
        parts.push(contentPart.text);
      }
    }
  }

  return parts.join('\n\n').trim();
}

function extractStreamTextDelta(eventName: string, dataLine: string): { delta?: string; completedText?: string } {
  if (!dataLine || dataLine === '[DONE]') {
    return {};
  }

  let payload: any;
  try {
    payload = JSON.parse(dataLine);
  } catch {
    return {};
  }

  if (eventName === 'response.output_text.delta' && typeof payload?.delta === 'string') {
    return { delta: payload.delta };
  }

  const choiceDelta = payload?.choices?.[0]?.delta?.content;
  if (typeof choiceDelta === 'string') {
    return { delta: choiceDelta };
  }

  const completedText = extractAssistantTextFromResponsesPayload(payload);
  if (completedText) {
    return { completedText };
  }

  return {};
}

async function consumeSseStream(
  response: Response,
  onEvent: (eventName: string, data: string) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      let eventName = 'message';
      const dataParts: string[] = [];
      for (const rawLine of frame.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (!line) {
          continue;
        }
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataParts.push(line.slice(5).trimStart());
        }
      }

      if (dataParts.length > 0) {
        onEvent(eventName, dataParts.join('\n'));
      }

      separatorIndex = buffer.indexOf('\n\n');
    }

    if (done) {
      break;
    }
  }
}

async function callLLMAPIStream(
  messages: { role: string; content: string }[],
  mode: ChatMode,
  callbacks: LLMResponseStreamCallbacks = {},
): Promise<string> {
  if (!currentConfig) {
    throw new Error('LLM未配置');
  }

  const temperature = mode === 'recommendation' ? 0.7 : 0.2;
  const model = resolveModelForMode(mode);
  const body = {
    model,
    messages,
    max_tokens: 1000,
    temperature,
    stream: true,
    providerBaseUrl: currentConfig.baseUrl,
    userApiKey: currentConfig.apiKey?.trim() ? currentConfig.apiKey : undefined,
  };

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error || `HTTP ${response.status} `;
    throw new Error(`API错误: ${errorMsg} `);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '{}';
  }

  let rawText = '';
  let completedText = '';
  let lastPreview = '';

  await consumeSseStream(response, (eventName, dataLine) => {
    const { delta, completedText: completedPayloadText } = extractStreamTextDelta(eventName, dataLine);

    if (typeof delta === 'string' && delta.length > 0) {
      rawText += delta;
      const preview = extractStreamingReplyPreview(rawText);
      if (preview && preview !== lastPreview) {
        lastPreview = preview;
        callbacks.onReplyUpdate?.(preview);
      }
    }

    if (!completedText && completedPayloadText) {
      completedText = completedPayloadText;
    }
  });

  return completedText || rawText;
}

// 模拟LLM响应 (Smart Mock / Free AI)
function mockLLMResponse(
  userInput: string,
  mode: ChatMode,
  activeGame?: Game,
  excludeIds: string[] = [],
  fallbackContext?: {
    recommendationIntent?: RecommendationIntent;
    recommendationCandidates?: RecommendationCandidate[];
    retrievedRulesContext?: string;
  },
): string {
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

    return JSON.stringify({
      reply: buildLocalRefereeFallbackReply(
        userInput,
        activeGame,
        fallbackContext?.retrievedRulesContext,
      ),
      switch_to_recommendation: false
    });
  }

  const recommendationIntent = fallbackContext?.recommendationIntent ?? parseRecommendationIntent(userInput);
  const candidates = fallbackContext?.recommendationCandidates?.length
    ? fallbackContext.recommendationCandidates
    : buildLocalRecommendationCandidates(userInput, recommendationIntent, excludeIds);

  const recommendedCandidate = candidates.find((candidate) => hasLocalizedGameTitle(candidate.game)) ?? candidates[0];

  if (!recommendedCandidate) {
    return JSON.stringify({
      thought: '候选不足，转为追问',
      reply: '你先告诉我这局大概几个人、想热闹一点还是想认真斗一斗，我就能把推荐收得更准。',
      recommendation_id: null,
    });
  }

  return JSON.stringify({
    thought: '本轮走本地兜底推荐，根据意图匹配、长期偏好和热度代理做了一次排序。',
    reply: buildCandidateFallbackReply(recommendedCandidate, recommendationIntent),
    recommendation_name: recommendedCandidate.game.titleCn,
    recommendation_id: recommendedCandidate.game.id,
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

async function prepareLlmTurn(
  userInput: string,
  mode: ChatMode,
  activeGame?: Game,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  excludeIds: string[] = [],
): Promise<PreparedLlmTurn> {
  const currentUserQuestion = extractCurrentUserQuestion(userInput);
  let retrievedRulesContext = '';
  let retrievedRuleCitations: InternalWikiCitation[] = [];
  let recommendationContext = '';
  let recommendationIntent: RecommendationIntent = { desiredTags: [], searchTerms: [] };
  let recommendationCandidates: RecommendationCandidate[] = [];
  const shouldUseKnowledgeRetrieval = !shouldSkipKnowledgeRetrieval(currentUserQuestion, mode);
  const excludedRecommendationNames = excludeIds
    .map((gameId) => GAME_DATABASE.find((game) => game.id === gameId)?.titleCn)
    .filter((title): title is string => Boolean(title))
    .slice(-8);

  const directRefereeAnswer = mode === 'referee'
    ? tryBuildDirectRefereeAnswer(currentUserQuestion, activeGame)
    : null;
  const directRecommendationAnswer = mode === 'recommendation'
    ? buildRecommendationConversationalReply(currentUserQuestion)
    : null;

  if (directRefereeAnswer) {
    return {
      currentUserQuestion,
      retrievedRulesContext,
      retrievedRuleCitations,
      recommendationContext,
      recommendationIntent,
      recommendationCandidates,
      excludedRecommendationNames,
      messages: [],
      directAnswer: directRefereeAnswer,
    };
  }

  if (directRecommendationAnswer) {
    return {
      currentUserQuestion,
      retrievedRulesContext,
      retrievedRuleCitations,
      recommendationContext,
      recommendationIntent,
      recommendationCandidates,
      excludedRecommendationNames,
      messages: [],
      directAnswer: directRecommendationAnswer,
    };
  }

  if (mode === 'referee' && activeGame && shouldUseKnowledgeRetrieval) {
    const evidencePack = buildInternalRefereeContext(activeGame, currentUserQuestion);
    retrievedRulesContext = evidencePack.contextText;
    retrievedRuleCitations = evidencePack.citations;
  } else if (mode === 'recommendation' && shouldUseKnowledgeRetrieval) {
    recommendationIntent = parseRecommendationIntent(currentUserQuestion);
    recommendationCandidates = buildLocalRecommendationCandidates(currentUserQuestion, recommendationIntent, excludeIds);
    if (recommendationCandidates.length > 0) {
      recommendationContext = formatRecommendationContext(recommendationCandidates, recommendationIntent);
    }
  }

  const systemPrompt = getSystemInstruction({
    mode,
    activeGame,
    retrievedRulesContext,
    retrievedRuleCitations,
    recommendationContext,
    excludedRecommendationNames,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: userInput },
  ];

  return {
    currentUserQuestion,
    retrievedRulesContext,
    retrievedRuleCitations,
    recommendationContext,
    recommendationIntent,
    recommendationCandidates,
    excludedRecommendationNames,
    messages,
  };
}

function finalizeLlmResponse(
  responseText: string,
  mode: ChatMode,
  excludeIds: string[],
  preparedTurn: PreparedLlmTurn,
): { text: string; gameId?: string; switchMode?: boolean; unknownGame?: string } {
  const {
    currentUserQuestion,
    retrievedRuleCitations,
    recommendationIntent,
    recommendationCandidates,
  } = preparedTurn;

  const parsedResult = parseStructuredLLMResponse(responseText);

  if (parsedResult) {
    if (mode === 'recommendation') {
      let finalId = parsedResult.recommendation_id;
      const recName = parsedResult.recommendation_name;
      const allowedCandidateIds = new Set(recommendationCandidates.map((candidate) => candidate.game.id));

      const text = sanitizeRecommendationReplyText(
        String(parsedResult.reply || '').replace(/\\n/g, '\n').replace(/\\\*/g, '*'),
      );

      const matches = Array.from(text.matchAll(/[《【](.*?)[》】]/g)).map((match) => match[1].replace(/[*_]/g, '').trim());
      const detectedGames = matches
        .map((name) => GAME_DATABASE.find((game) => game.titleCn === name || game.titleEn === name))
        .filter((game) => game);
      const detectedGameId = detectedGames.length > 0
        ? detectedGames[detectedGames.length - 1]!.id
        : undefined;

      const primaryGameById = GAME_DATABASE.find((game) => game.id === finalId);
      const primaryGameByName = GAME_DATABASE.find((game) => game.titleCn === recName || game.titleEn === recName);

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

      if (finalId && !GAME_DATABASE.some((game) => game.id === finalId)) {
        finalId = undefined;
      }

      const finalGame = finalId ? GAME_DATABASE.find((game) => game.id === finalId) : undefined;
      const safeFallbackCandidate = recommendationCandidates.find((candidate) => hasLocalizedGameTitle(candidate.game))
        ?? recommendationCandidates[0];

      if (
        finalId &&
        allowedCandidateIds.size > 0 &&
        !allowedCandidateIds.has(finalId) &&
        !excludeIds.includes(finalId) &&
        hasStrictRecommendationConstraint(recommendationIntent) &&
        !parsedResult.unknown_target_game
      ) {
        if (safeFallbackCandidate) {
          return {
            text: buildCandidateFallbackReply(safeFallbackCandidate, recommendationIntent, 'out_of_pool'),
            gameId: safeFallbackCandidate.game.id,
          };
        }
      }

      if (finalGame && !parsedResult.unknown_target_game && !isGameCompatibleWithIntent(finalGame, recommendationIntent) && safeFallbackCandidate) {
        return {
          text: buildCandidateFallbackReply(safeFallbackCandidate, recommendationIntent, 'out_of_pool'),
          gameId: safeFallbackCandidate.game.id,
        };
      }

      if (finalGame && shouldAvoidAutoSurfacingUnlocalizedGame(finalGame, currentUserQuestion)) {
        if (safeFallbackCandidate) {
          return {
            text: buildCandidateFallbackReply(safeFallbackCandidate, recommendationIntent, 'out_of_pool'),
            gameId: safeFallbackCandidate.game.id,
          };
        }
      }

      if (finalGame && !parsedResult.unknown_target_game && shouldForceLocalRecommendationRewrite(text)) {
        const rewriteCandidate = recommendationCandidates.find((candidate) => candidate.game.id === finalGame.id) ?? {
          game: finalGame,
          aggregateScore: 0,
          matchedSections: [],
          snippets: [finalGame.oneLiner],
        };

        return {
          text: buildCandidateFallbackReply(rewriteCandidate, recommendationIntent),
          gameId: rewriteCandidate.game.id,
        };
      }

      return {
        text: text || '我好像走神了...',
        gameId: finalId,
        unknownGame: parsedResult.unknown_target_game,
      };
    }

    const replyText = sanitizeRefereeReplyText(
      String(parsedResult.reply || '').replace(/\\n/g, '\n').replace(/\\\*/g, '*'),
    );
    const finalText = buildCitationReferenceBlock(replyText, retrievedRuleCitations);
    return {
      text: finalText || '规则判定中...',
      switchMode: parsedResult.switch_to_recommendation,
    };
  }

  console.error('JSON Parse Error', responseText);
  const fallbackReplyText = extractFallbackReplyText(responseText);

  if (mode === 'recommendation') {
    if (fallbackReplyText) {
      const sanitizedFallbackText = sanitizeRecommendationReplyText(fallbackReplyText);
      const mentionedGames = extractMentionedGamesFromRecommendationText(sanitizedFallbackText);

      if (shouldForceFallbackCardRewrite(sanitizedFallbackText, mentionedGames) && recommendationCandidates.length > 0) {
        const fallbackCandidate = recommendationCandidates.find((candidate) => hasLocalizedGameTitle(candidate.game))
          ?? recommendationCandidates[0];
        return {
          text: buildCandidateFallbackReply(fallbackCandidate, recommendationIntent),
          gameId: fallbackCandidate.game.id,
        };
      }

      if (mentionedGames.length === 1) {
        const detectedGame = mentionedGames[0];

        if (
          !shouldAvoidAutoSurfacingUnlocalizedGame(detectedGame, currentUserQuestion)
          && isGameCompatibleWithIntent(detectedGame, recommendationIntent)
        ) {
          return {
            text: sanitizedFallbackText,
            gameId: detectedGame.id,
          };
        }
      }

      if (recommendationCandidates.length > 0) {
        const fallbackCandidate = recommendationCandidates.find((candidate) => hasLocalizedGameTitle(candidate.game))
          ?? recommendationCandidates[0];
        return {
          text: buildCandidateFallbackReply(fallbackCandidate, recommendationIntent),
          gameId: fallbackCandidate.game.id,
        };
      }

      return {
        text: sanitizedFallbackText,
      };
    }
    if (recommendationCandidates.length > 0) {
      const fallbackCandidate = recommendationCandidates.find((candidate) => hasLocalizedGameTitle(candidate.game))
        ?? recommendationCandidates[0];
      return {
        text: buildCandidateFallbackReply(fallbackCandidate, recommendationIntent),
        gameId: fallbackCandidate.game.id,
      };
    }
    return {
      text: fallbackReplyText || '我先换个问法帮你推荐。你想几个人玩、玩多久、偏热闹还是烧脑？',
    };
  }

  return {
    text: buildCitationReferenceBlock(
      fallbackReplyText || '我先按当前理解给你判一下，你也可以补一句更具体的场上情况。',
      retrievedRuleCitations,
    ),
  };
}

// 主函数：获取LLM回复
export async function getLLMResponse(
  userInput: string,
  mode: ChatMode = 'recommendation',
  activeGame?: Game,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  excludeIds: string[] = []
): Promise<{ text: string; gameId?: string; switchMode?: boolean; unknownGame?: string }> {
  const preparedTurn = await prepareLlmTurn(userInput, mode, activeGame, history, excludeIds);
  if (preparedTurn.directAnswer) {
    return {
      text: preparedTurn.directAnswer,
    };
  }

  let responseText = '';

  if (!useMockMode && currentConfig) {
    try {
      responseText = await callLLMAPI(preparedTurn.messages, mode);
    } catch (error) {
      console.error('LLM调用失败，本轮转本地兜底:', error);
      responseText = mockLLMResponse(preparedTurn.currentUserQuestion, mode, activeGame, excludeIds, {
        recommendationIntent: preparedTurn.recommendationIntent,
        recommendationCandidates: preparedTurn.recommendationCandidates,
        retrievedRulesContext: preparedTurn.retrievedRulesContext,
      });
    }
  } else {
    responseText = mockLLMResponse(preparedTurn.currentUserQuestion, mode, activeGame, excludeIds, {
      recommendationIntent: preparedTurn.recommendationIntent,
      recommendationCandidates: preparedTurn.recommendationCandidates,
      retrievedRulesContext: preparedTurn.retrievedRulesContext,
    });
  }

  return finalizeLlmResponse(responseText, mode, excludeIds, preparedTurn);
}

export async function getLLMResponseStream(
  userInput: string,
  mode: ChatMode = 'recommendation',
  activeGame?: Game,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  excludeIds: string[] = [],
  callbacks: LLMResponseStreamCallbacks = {},
): Promise<{ text: string; gameId?: string; switchMode?: boolean; unknownGame?: string }> {
  const preparedTurn = await prepareLlmTurn(userInput, mode, activeGame, history, excludeIds);
  if (preparedTurn.directAnswer) {
    callbacks.onReplyUpdate?.(preparedTurn.directAnswer);
    return {
      text: preparedTurn.directAnswer,
    };
  }

  let responseText = '';

  if (!useMockMode && currentConfig) {
    try {
      responseText = await callLLMAPIStream(preparedTurn.messages, mode, callbacks);
    } catch (error) {
      console.error('LLM流式调用失败，本轮转本地兜底:', error);
      responseText = mockLLMResponse(preparedTurn.currentUserQuestion, mode, activeGame, excludeIds, {
        recommendationIntent: preparedTurn.recommendationIntent,
        recommendationCandidates: preparedTurn.recommendationCandidates,
        retrievedRulesContext: preparedTurn.retrievedRulesContext,
      });
      const fallbackPreview = extractFallbackReplyText(responseText);
      if (fallbackPreview) {
        callbacks.onReplyUpdate?.(fallbackPreview);
      }
    }
  } else {
    responseText = mockLLMResponse(preparedTurn.currentUserQuestion, mode, activeGame, excludeIds, {
      recommendationIntent: preparedTurn.recommendationIntent,
      recommendationCandidates: preparedTurn.recommendationCandidates,
      retrievedRulesContext: preparedTurn.retrievedRulesContext,
    });
    const fallbackPreview = extractFallbackReplyText(responseText);
    if (fallbackPreview) {
      callbacks.onReplyUpdate?.(fallbackPreview);
    }
  }

  return finalizeLlmResponse(responseText, mode, excludeIds, preparedTurn);
}

// 初始化配置
export function initLLMConfig() {
  const targetConfig: LLMConfig = {
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'deepseek-v3-2-251201',
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

export async function getGameRecommendationStream(
  query: string,
  excludeIds: string[] = [],
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  mode: ChatMode = 'recommendation',
  activeGame?: Game,
  callbacks: LLMResponseStreamCallbacks = {},
): Promise<{ text: string; game?: Game; switchMode?: boolean }> {
  const { text, gameId, switchMode, unknownGame } = await getLLMResponseStream(
    query,
    mode,
    activeGame,
    history,
    excludeIds,
    callbacks,
  );

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
    const game = GAME_DATABASE.find((item) => item.id === gameId);
    if (game) {
      return { text, game, switchMode };
    }
  }

  return { text, switchMode };
}

// 获取当前API提供商
export function getCurrentProvider(): string {
  return currentConfig?.baseUrl.includes('ark.cn-beijing.volces.com') ? 'volcengine' :
    currentConfig?.baseUrl.includes('deepseek') ? 'deepseek' :
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
