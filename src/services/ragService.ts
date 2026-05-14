import { GAME_DATABASE } from '@/data/gameDatabase';
import {
  getGameRecommendation,
  getGameRecommendationStream,
  parseRecommendationIntent,
  type RecommendationIntent,
} from './llmService';
import { getPersistentContextForPrompt } from './memoryService';
import type {
  ChatMode,
  DialogueContextMemory,
  DialogueSessionMemory,
  Game,
  RecommendationIntentAction,
  RecommendationSessionState,
} from '@/types';

// RAG 检索结果
interface RetrievalResult {
  games: Game[];
  context: string;
  answer: string;
  switchMode?: boolean;
}

type DialogueContext = DialogueContextMemory;

interface DialogueStreamCallbacks {
  onAnswerUpdate?: (text: string) => void;
}

const CHINESE_PLAYER_COUNT_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  俩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
const RESET_RECOMMENDATION_CONTEXT_PATTERN = /(重新开始|从头来|从头开始|别管刚才|不按刚才|忘掉刚才|清空刚才|新的需求|全新推荐|换个场景|另一个场景|重新推荐)/;
const CONTINUE_RECOMMENDATION_PATTERN = /(换一个|再推荐|再来一个|还有别的吗|还有别的|下一个|类似的|同样的|不要这个|不喜欢这个)/;
const OVERRIDE_RECOMMENDATION_PATTERN = /(改成|改为|换成|换为|变成|这次|现在|这回|那就|不要|不用|别|不想|去掉|排除)/;
const REFEREE_TO_RECOMMENDATION_PATTERN = /(换(一个|个|别的|另一?个)?游戏|换一个吧|换个吧|不玩这个了?|不玩了|回到推荐|切回推荐|推荐别的|推荐一个别的|还有别的(?:游戏)?吗|下一个游戏)/;
const NEGATIVE_RECOMMENDATION_GROUPS = [
  {
    pattern: /(不要|不用|别|不想|去掉|排除)[^，。；,.、]{0,10}(纸笔|写写画画|图图写写|画画|绘图|填表|填色)/,
    tags: ['纸笔规划'],
    terms: ['纸笔', '写写画画', '图图写写', '画画', '绘图', '填表', '填色'],
  },
  {
    pattern: /(不要|不用|别|不想|去掉|排除)[^，。；,.、]{0,10}(阵营|身份|狼人|阿瓦隆|嘴炮)/,
    tags: ['阵营推理', '嘴炮谈判'],
    terms: ['阵营', '身份', '狼人', '阿瓦隆', '嘴炮'],
  },
  {
    pattern: /(不要|不用|别|不想|去掉|排除)[^，。；,.、]{0,10}(重策|重度|烧脑|复杂|太难)/,
    tags: ['烧脑策略', '重策略'],
    terms: ['重策', '重度', '烧脑', '复杂', '太难'],
  },
] as const;

function dedupeOrdered<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createEmptyRecommendationSessionState(): RecommendationSessionState {
  return {
    desiredTags: [],
    searchTerms: [],
    excludedTags: [],
    excludedTerms: [],
    sourceTurns: [],
  };
}

function cloneRecommendationSessionState(state?: RecommendationSessionState): RecommendationSessionState {
  return {
    ...createEmptyRecommendationSessionState(),
    ...state,
    desiredTags: [...(state?.desiredTags ?? [])],
    searchTerms: [...(state?.searchTerms ?? [])],
    excludedTags: [...(state?.excludedTags ?? [])],
    excludedTerms: [...(state?.excludedTerms ?? [])],
    sourceTurns: [...(state?.sourceTurns ?? [])],
  };
}

function createEmptyDialogueContext(): DialogueContext {
  return {
    preferredTags: [],
    mentionedGames: [],
    recommendationState: createEmptyRecommendationSessionState(),
    turnCount: 0,
    lastQuery: '',
    history: [],
  };
}

function normalizeDialogueContext(context?: Partial<DialogueContextMemory>): DialogueContext {
  const complexity = context?.complexity;

  return {
    playerCount: typeof context?.playerCount === 'number' ? context.playerCount : undefined,
    scenario: typeof context?.scenario === 'string' ? context.scenario : undefined,
    complexity: complexity === 'low' || complexity === 'medium' || complexity === 'high' ? complexity : undefined,
    preferredTags: Array.isArray(context?.preferredTags) ? [...context.preferredTags] : [],
    mentionedGames: Array.isArray(context?.mentionedGames) ? [...context.mentionedGames] : [],
    recommendationState: cloneRecommendationSessionState(context?.recommendationState),
    turnCount: typeof context?.turnCount === 'number' ? context.turnCount : 0,
    lastQuery: typeof context?.lastQuery === 'string' ? context.lastQuery : '',
    history: Array.isArray(context?.history)
      ? context.history
        .filter((entry) => (
          (entry.role === 'user' || entry.role === 'assistant')
          && typeof entry.content === 'string'
          && entry.content.trim().length > 0
        ))
        .map((entry) => ({ role: entry.role, content: entry.content }))
        .slice(-20)
      : [],
  };
}

export function isRefereeRecommendationSwitchRequest(input: string): boolean {
  return REFEREE_TO_RECOMMENDATION_PATTERN.test(input.trim());
}

function hasRecommendationIntentSignal(intent: RecommendationIntent): boolean {
  return Boolean(
    typeof intent.requestedPlayerCount === 'number'
    || typeof intent.requestedPlayerRangeMin === 'number'
    || typeof intent.requestedPlayerRangeMax === 'number'
    || typeof intent.maxPlaytime === 'number'
    || typeof intent.maxAgeRating === 'number'
    || typeof intent.maxComplexity === 'number'
    || typeof intent.minComplexity === 'number'
    || intent.desiredTags.length > 0
    || intent.searchTerms.length > 0
  );
}

function detectRecommendationAction(
  input: string,
  intent: RecommendationIntent,
  previousState?: RecommendationSessionState,
): RecommendationIntentAction {
  const text = input.trim();
  const hasPreviousState = Boolean(previousState && (
    previousState.sourceTurns.length > 0
    || previousState.desiredTags.length > 0
    || previousState.searchTerms.length > 0
    || typeof previousState.requestedPlayerCount === 'number'
    || typeof previousState.requestedPlayerRangeMin === 'number'
    || typeof previousState.requestedPlayerRangeMax === 'number'
  ));

  if (!text || /^(你好|您好|嗨|哈喽|hello|hi|谢谢|谢啦|好的|好滴|ok|收到|明白|哈哈|嗯嗯|嗯|哦)[!！,.。?？~～]*$/i.test(text)) {
    return 'smalltalk';
  }
  if (RESET_RECOMMENDATION_CONTEXT_PATTERN.test(text)) {
    return 'reset';
  }
  if (OVERRIDE_RECOMMENDATION_PATTERN.test(text) && hasRecommendationIntentSignal(intent)) {
    return hasPreviousState ? 'override' : 'new';
  }
  if (CONTINUE_RECOMMENDATION_PATTERN.test(text)) {
    return hasPreviousState ? 'continue' : 'new';
  }
  if (hasPreviousState && hasRecommendationIntentSignal(intent)) {
    return 'refine';
  }

  return hasRecommendationIntentSignal(intent) ? 'new' : 'smalltalk';
}

function collectNegativeRecommendationSignals(input: string) {
  const excludedTags: string[] = [];
  const excludedTerms: string[] = [];

  for (const group of NEGATIVE_RECOMMENDATION_GROUPS) {
    if (!group.pattern.test(input)) {
      continue;
    }

    excludedTags.push(...group.tags);
    excludedTerms.push(...group.terms);
  }

  return {
    excludedTags: dedupeOrdered(excludedTags),
    excludedTerms: dedupeOrdered(excludedTerms),
  };
}

function removeExcludedSignals(values: string[], excludedTags: string[], excludedTerms: string[]): string[] {
  const normalizedExcluded = new Set([...excludedTags, ...excludedTerms]);
  return values.filter((value) => !normalizedExcluded.has(value));
}

function mergeRecommendationSessionState(
  previousState: RecommendationSessionState | undefined,
  input: string,
): RecommendationSessionState {
  const parsedIntent = parseRecommendationIntent(input);
  const action = detectRecommendationAction(input, parsedIntent, previousState);
  const negativeSignals = collectNegativeRecommendationSignals(input);
  const baseState = action === 'reset' || action === 'new'
    ? createEmptyRecommendationSessionState()
    : cloneRecommendationSessionState(previousState);

  if (action === 'smalltalk') {
    return {
      ...baseState,
      lastAction: action,
      updatedAt: Date.now(),
    };
  }

  const nextState = cloneRecommendationSessionState(baseState);
  if (
    typeof parsedIntent.requestedPlayerRangeMin === 'number'
    && typeof parsedIntent.requestedPlayerRangeMax === 'number'
  ) {
    nextState.requestedPlayerCount = undefined;
    nextState.requestedPlayerRangeMin = parsedIntent.requestedPlayerRangeMin;
    nextState.requestedPlayerRangeMax = parsedIntent.requestedPlayerRangeMax;
  } else if (typeof parsedIntent.requestedPlayerCount === 'number') {
    nextState.requestedPlayerCount = parsedIntent.requestedPlayerCount;
    nextState.requestedPlayerRangeMin = undefined;
    nextState.requestedPlayerRangeMax = undefined;
  }
  if (typeof parsedIntent.maxPlaytime === 'number') {
    nextState.maxPlaytime = parsedIntent.maxPlaytime;
  }
  if (typeof parsedIntent.maxAgeRating === 'number') {
    nextState.maxAgeRating = parsedIntent.maxAgeRating;
  }
  if (typeof parsedIntent.maxComplexity === 'number') {
    nextState.maxComplexity = parsedIntent.maxComplexity;
    nextState.minComplexity = undefined;
  }
  if (typeof parsedIntent.minComplexity === 'number') {
    nextState.minComplexity = parsedIntent.minComplexity;
    if (!/别太浅|有点策略|中等|适中/.test(input)) {
      nextState.maxComplexity = undefined;
    }
  }

  nextState.excludedTags = dedupeOrdered([...nextState.excludedTags, ...negativeSignals.excludedTags]);
  nextState.excludedTerms = dedupeOrdered([...nextState.excludedTerms, ...negativeSignals.excludedTerms]);
  nextState.desiredTags = dedupeOrdered(
    removeExcludedSignals([...nextState.desiredTags, ...parsedIntent.desiredTags], nextState.excludedTags, nextState.excludedTerms),
  );
  nextState.searchTerms = dedupeOrdered(
    removeExcludedSignals([...nextState.searchTerms, ...parsedIntent.searchTerms], nextState.excludedTags, nextState.excludedTerms),
  );
  nextState.sourceTurns = dedupeOrdered([...nextState.sourceTurns, input.trim()].filter(Boolean)).slice(-8);
  nextState.lastAction = action;
  nextState.updatedAt = Date.now();

  return nextState;
}

function buildRecommendationStatePrompt(state?: RecommendationSessionState): string {
  if (!state) {
    return '';
  }

  const lines: string[] = [];
  if (typeof state.requestedPlayerRangeMin === 'number' && typeof state.requestedPlayerRangeMax === 'number') {
    lines.push(`- 当前有效人数硬约束：${state.requestedPlayerRangeMin}-${state.requestedPlayerRangeMax}人。`);
  } else if (typeof state.requestedPlayerCount === 'number') {
    lines.push(`- 当前有效人数硬约束：${state.requestedPlayerCount}人。`);
  }
  if (typeof state.maxPlaytime === 'number') {
    lines.push(`- 当前有效时长硬约束：不超过 ${state.maxPlaytime} 分钟。`);
  }
  if (typeof state.maxAgeRating === 'number') {
    lines.push(`- 当前有效年龄硬约束：适合 ${state.maxAgeRating} 岁左右或更低门槛。`);
  }
  if (typeof state.maxComplexity === 'number') {
    lines.push(`- 当前有效复杂度倾向：不要高于 ${state.maxComplexity.toFixed(1)}，优先轻松好教。`);
  }
  if (typeof state.minComplexity === 'number') {
    lines.push('- 当前有效复杂度倾向：不要太浅，至少有一点策略深度。');
  }
  if (state.desiredTags.length > 0) {
    lines.push(`- 当前有效意图标签：${state.desiredTags.join('、')}。`);
  }
  if (state.excludedTags.length > 0 || state.excludedTerms.length > 0) {
    lines.push(`- 当前明确排除：${dedupeOrdered([...state.excludedTags, ...state.excludedTerms]).join('、')}。`);
  }

  return lines.length > 0
    ? ['【本轮会话意图判断】', ...lines, '除非用户明确覆盖，否则以上约束继续生效。'].join('\n')
    : '';
}

function inferPlayerCountFromText(text: string): number | undefined {
  const digitMatch = text.match(/(\d+)\s*(?:个人|人|位)/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }

  const chineseMatch = text.match(/([一二两俩三四五六七八九十])\s*(?:个人|人|位)/);
  return chineseMatch ? CHINESE_PLAYER_COUNT_MAP[chineseMatch[1]] : undefined;
}

function inferComplexityFromText(text: string): 'low' | 'medium' | 'high' | undefined {
  if (/简单|轻松|休闲|入门|新手友好/.test(text)) {
    return 'low';
  }
  if (/烧脑|策略|硬核|高复杂|深度/.test(text)) {
    return 'high';
  }
  if (/中等|适中/.test(text)) {
    return 'medium';
  }
  return undefined;
}

function inferPreferredTagsFromText(text: string): string[] {
  const inferredTags: string[] = [];

  if (/亲子|家庭/.test(text)) {
    inferredTags.push('亲子');
  }
  if (/情侣|约会/.test(text)) {
    inferredTags.push('情侣');
  }
  if (/聚会|热闹/.test(text)) {
    inferredTags.push('聚会');
  }
  if (/破冰|社交/.test(text)) {
    inferredTags.push('破冰');
  }
  if (/烧脑|策略|推理/.test(text)) {
    inferredTags.push('策略');
  }

  return dedupeOrdered(inferredTags);
}

function getStructuredTags(game: Game): string[] {
  return game.recommendationProfile?.allTags ?? game.tags;
}

// 计算游戏与查询的匹配分数（用于相似游戏推荐）
export function calculateMatchScore(game: Game, targetGame: Game): number {
  let score = 0;

  // 标签相似度
  const gameTags = getStructuredTags(game);
  const targetTags = getStructuredTags(targetGame);
  const commonTags = gameTags.filter(tag => targetTags.includes(tag));
  score += commonTags.length * 3;

  // 复杂度接近
  const complexityDiff = Math.abs(game.complexity - targetGame.complexity);
  score -= complexityDiff;

  // 人数范围重叠
  const playerOverlap = Math.min(game.maxPlayers, targetGame.maxPlayers) -
    Math.max(game.minPlayers, targetGame.minPlayers);
  if (playerOverlap > 0) {
    score += 2;
  }

  return score;
}

// 回答游戏规则相关问题
export function answerGameQuestion(gameId: string, question: string): string {
  const game = GAME_DATABASE.find(g => g.id === gameId);
  if (!game) return '抱歉，没有找到这款游戏的信息。';

  // 获胜条件
  if (/赢|胜利|目标|怎么算|获胜|胜利条件/.test(question)) {
    return `【${game.titleCn}获胜条件】\n\n${game.rules.target}`;
  }

  // 游戏流程
  if (/流程|怎么玩|回合|玩法|进行|步骤/.test(question)) {
    return `【${game.titleCn}游戏流程】\n\n${game.rules.flow}`;
  }

  // 注意事项
  if (/注意|技巧|错误|提示|建议|心得/.test(question)) {
    return `【${game.titleCn}新手技巧】\n\n${game.rules.tips}`;
  }

  // 人数
  if (/人数|几个|多少人|几人/.test(question)) {
    return `《${game.titleCn}》支持${game.minPlayers}-${game.maxPlayers}人游玩。`;
  }

  // 时长
  if (/时间|多久|时长|一局|多长时间/.test(question)) {
    return `《${game.titleCn}》一局大约需要${game.playtimeMin}分钟。`;
  }

  // 难度
  if (/难度|复杂|难不难|简单/.test(question)) {
    const difficultyText = game.complexity <= 1.5 ? '很简单，新手友好' :
      game.complexity <= 2.5 ? '中等难度，有策略但不烧脑' :
        '比较有深度，适合喜欢思考的玩家';
    return `《${game.titleCn}》复杂度${game.complexity}/5，${difficultyText}。`;
  }

  // 默认返回综合信息
  return `关于《${game.titleCn}》：\n\n${game.oneLiner}\n\n你可以问我：\n• 怎么算赢？\n• 游戏流程是什么？\n• 有什么技巧？\n• 适合几个人玩？`;
}

// 对话Agent类 - 管理多轮对话状态
export class DialogueAgent {
  private sessionGames: string[] = [];
  private context: DialogueContext = createEmptyDialogueContext();
  // private useLLM: boolean = false;

  constructor(_useLLM: boolean = false) {
    // this.useLLM = _useLLM;
  }

  // 设置是否使用LLM
  setUseLLM(_use: boolean) {
    // this.useLLM = _use;
  }

  rememberShownGame(gameId: string): void {
    if (!this.sessionGames.includes(gameId)) {
      this.sessionGames.push(gameId);
    }
  }

  private mergeInputSignalsIntoContext(input: string, mode: ChatMode): void {
    const nextPlayerCount = inferPlayerCountFromText(input);
    if (typeof nextPlayerCount === 'number') {
      this.context.playerCount = nextPlayerCount;
    }

    const nextComplexity = inferComplexityFromText(input);
    if (nextComplexity) {
      this.context.complexity = nextComplexity;
    }

    const nextPreferredTags = inferPreferredTagsFromText(input);
    if (nextPreferredTags.length > 0) {
      this.context.preferredTags = dedupeOrdered([...this.context.preferredTags, ...nextPreferredTags]);
    }

    if (mode !== 'recommendation') {
      return;
    }

    this.context.recommendationState = mergeRecommendationSessionState(
      this.context.recommendationState,
      input,
    );

    if (typeof this.context.recommendationState.requestedPlayerCount === 'number') {
      this.context.playerCount = this.context.recommendationState.requestedPlayerCount;
    }

    this.context.preferredTags = dedupeOrdered([
      ...this.context.preferredTags,
      ...this.context.recommendationState.desiredTags,
    ]);
  }

  // 处理用户输入
  async processInput(input: string, mode: ChatMode = 'recommendation', activeGame?: Game): Promise<RetrievalResult> {
    const shouldSwitchToRecommendation = mode === 'referee' && isRefereeRecommendationSwitchRequest(input);
    const effectiveMode: ChatMode = shouldSwitchToRecommendation ? 'recommendation' : mode;
    if (shouldSwitchToRecommendation && activeGame) {
      this.rememberShownGame(activeGame.id);
    }

    this.mergeInputSignalsIntoContext(input, effectiveMode);

    // 更新上下文
    this.context.lastQuery = input;
    this.context.turnCount++;

    // 添加到历史记录
    this.context.history.push({ role: 'user', content: input });

    // 限制历史记录长度
    if (this.context.history.length > 20) {
      this.context.history = this.context.history.slice(-20);
    }

    // 调用统一的 LLM 服务
    // 加入长期记忆库 (Long-term Persistent Memory)
    const persistentMemory = getPersistentContextForPrompt();
    let finalQueryForLLM = input;

    // 如果是推荐模式并且有长期累积资产，在输入前悄悄附加上下文
    if (effectiveMode === 'recommendation' && persistentMemory) {
      finalQueryForLLM = `${persistentMemory}\n\n[用户的当前提问]:\n${input}`;
    }

    const result = await getGameRecommendation(
      finalQueryForLLM,
      this.sessionGames,
      this.context.history.slice(0, -1),
      effectiveMode,
      effectiveMode === 'referee' ? activeGame : undefined,
      {
        recommendationIntent: effectiveMode === 'recommendation' ? this.context.recommendationState : undefined,
        recommendationSessionState: effectiveMode === 'recommendation' ? cloneRecommendationSessionState(this.context.recommendationState) : undefined,
        recommendationSessionContext: effectiveMode === 'recommendation'
          ? buildRecommendationStatePrompt(this.context.recommendationState)
          : undefined,
      },
    );

    if (result.game) {
      if (!this.sessionGames.includes(result.game.id)) {
        this.sessionGames.push(result.game.id);
      }
      if (!this.context.mentionedGames.includes(result.game.id)) {
        this.context.mentionedGames.push(result.game.id);
      }
    }

    // 添加AI回复到历史
    this.context.history.push({ role: 'assistant', content: result.text });

    return {
      games: result.game ? [result.game] : [],
      context: '',
      answer: result.text,
      switchMode: result.switchMode || shouldSwitchToRecommendation,
    };
  }

  async processInputStream(
    input: string,
    mode: ChatMode = 'recommendation',
    activeGame?: Game,
    callbacks: DialogueStreamCallbacks = {},
  ): Promise<RetrievalResult> {
    const shouldSwitchToRecommendation = mode === 'referee' && isRefereeRecommendationSwitchRequest(input);
    const effectiveMode: ChatMode = shouldSwitchToRecommendation ? 'recommendation' : mode;
    if (shouldSwitchToRecommendation && activeGame) {
      this.rememberShownGame(activeGame.id);
    }

    this.mergeInputSignalsIntoContext(input, effectiveMode);

    this.context.lastQuery = input;
    this.context.turnCount++;
    this.context.history.push({ role: 'user', content: input });

    if (this.context.history.length > 20) {
      this.context.history = this.context.history.slice(-20);
    }

    const persistentMemory = getPersistentContextForPrompt();
    let finalQueryForLLM = input;

    if (effectiveMode === 'recommendation' && persistentMemory) {
      finalQueryForLLM = `${persistentMemory}\n\n[用户的当前提问]:\n${input}`;
    }

    const result = await getGameRecommendationStream(
      finalQueryForLLM,
      this.sessionGames,
      this.context.history.slice(0, -1),
      effectiveMode,
      effectiveMode === 'referee' ? activeGame : undefined,
      {
        onReplyUpdate: callbacks.onAnswerUpdate,
      },
      {
        recommendationIntent: effectiveMode === 'recommendation' ? this.context.recommendationState : undefined,
        recommendationSessionState: effectiveMode === 'recommendation' ? cloneRecommendationSessionState(this.context.recommendationState) : undefined,
        recommendationSessionContext: effectiveMode === 'recommendation'
          ? buildRecommendationStatePrompt(this.context.recommendationState)
          : undefined,
      },
    );

    if (result.game) {
      if (!this.sessionGames.includes(result.game.id)) {
        this.sessionGames.push(result.game.id);
      }
      if (!this.context.mentionedGames.includes(result.game.id)) {
        this.context.mentionedGames.push(result.game.id);
      }
    }

    this.context.history.push({ role: 'assistant', content: result.text });

    return {
      games: result.game ? [result.game] : [],
      context: '',
      answer: result.text,
      switchMode: result.switchMode || shouldSwitchToRecommendation,
    };
  }

  // 获取已推荐的游戏ID列表
  getSessionGames(): string[] {
    return [...this.sessionGames];
  }

  // 获取对话上下文
  getContext(): DialogueContext {
    return {
      ...this.context,
      preferredTags: [...this.context.preferredTags],
      mentionedGames: [...this.context.mentionedGames],
      recommendationState: cloneRecommendationSessionState(this.context.recommendationState),
      history: this.context.history.map((entry) => ({ ...entry })),
    };
  }

  getSnapshot(): DialogueSessionMemory {
    return {
      version: 1,
      sessionGames: this.getSessionGames(),
      context: this.getContext(),
      updatedAt: Date.now(),
    };
  }

  restoreSnapshot(snapshot?: DialogueSessionMemory | null): void {
    if (!snapshot) {
      this.reset();
      return;
    }

    this.sessionGames = Array.isArray(snapshot.sessionGames)
      ? dedupeOrdered(snapshot.sessionGames.filter((gameId) => typeof gameId === 'string' && gameId.trim()))
      : [];
    this.context = normalizeDialogueContext(snapshot.context);
  }

  // 重置会话
  reset(): void {
    this.sessionGames = [];
    this.context = createEmptyDialogueContext();
  }
}

// 创建全局Agent实例
export const dialogueAgent = new DialogueAgent(false);

// 基于知识库的检索（向后兼容，虽然目前 ChatPage 主要用 dialogueAgent）
export async function retrieveGames(query: string, _excludeIds: string[] = []): Promise<RetrievalResult> {
  // 简单包装一下，以保持接口兼容
  const agent = new DialogueAgent(false);
  return await agent.processInput(query);
}

// Re-export getSimilarGames for compatibility if needed
export { getSimilarGames } from './llmService';
