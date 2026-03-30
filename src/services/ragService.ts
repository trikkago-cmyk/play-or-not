import { GAME_DATABASE } from '@/data/gameDatabase';
import { getGameRecommendation, getSimilarGames } from './llmService';
import { getPersistentContextForPrompt } from './memoryService';
import type { Game } from '@/types';

// RAG 检索结果
interface RetrievalResult {
  games: Game[];
  context: string;
  answer: string;
  switchMode?: boolean;
}

// 对话上下文
interface DialogueContext {
  playerCount?: number;
  scenario?: string;
  complexity?: 'low' | 'medium' | 'high';
  preferredTags: string[];
  mentionedGames: string[];
  turnCount: number;
  lastQuery: string;
  history: { role: 'user' | 'assistant'; content: string }[];
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
  private context: DialogueContext = {
    preferredTags: [],
    mentionedGames: [],
    turnCount: 0,
    lastQuery: '',
    history: [],
  };
  // private useLLM: boolean = false;

  constructor(_useLLM: boolean = false) {
    // this.useLLM = _useLLM;
  }

  // 设置是否使用LLM
  setUseLLM(_use: boolean) {
    // this.useLLM = _use;
  }

  // 处理用户输入
  async processInput(input: string, mode: 'recommendation' | 'referee' = 'recommendation', activeGame?: Game): Promise<RetrievalResult> {
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
    if (mode === 'recommendation' && persistentMemory) {
      finalQueryForLLM = `${persistentMemory}\n\n[用户的当前提问]:\n${input}`;
    }

    const result = await getGameRecommendation(finalQueryForLLM, this.sessionGames, this.context.history, mode, activeGame);

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

    // 获取同类备选（仅在推荐模式下且有推荐结果时）
    const alternativeGames = (mode === 'recommendation' && result.game)
      ? getSimilarGames(result.game.id, this.sessionGames).slice(0, 3)
      : [];

    return {
      games: result.game ? [result.game, ...alternativeGames] : alternativeGames, // 推荐模式下返回主要推荐+备选
      context: '',
      answer: result.text,
      switchMode: result.switchMode // 传递切换信号
    };
  }

  // 获取已推荐的游戏ID列表
  getSessionGames(): string[] {
    return [...this.sessionGames];
  }

  // 获取对话上下文
  getContext(): DialogueContext {
    return { ...this.context };
  }

  // 重置会话
  reset(): void {
    this.sessionGames = [];
    this.context = {
      preferredTags: [],
      mentionedGames: [],
      turnCount: 0,
      lastQuery: '',
      history: [],
    };
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
