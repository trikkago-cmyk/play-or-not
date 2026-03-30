// Game types
export interface RecommendationProfile {
  playerTags: string[];
  durationTags: string[];
  complexityTags: string[];
  occasionTags: string[];
  interactionTags: string[];
  mechanicTags: string[];
  moodTags: string[];
  themeTags: string[];
  allTags: string[];
  searchTerms: string[];
}

export interface Game {
  id: string;
  titleCn: string;
  titleEn: string;
  coverUrl: string;
  minPlayers: number;
  maxPlayers: number;
  playtimeMin: number;
  ageRating: number;
  complexity: number;
  tags: string[];
  oneLiner: string;
  rules: {
    target: string;
    flow: string;
    tips: string;
  };
  FAQ: string; // 常用问题（全网搜集游戏相关的问题与解答
  commonQuestions?: string[]; // 裁判模式下的快捷问题
  knowledgeBase?: string;
  tutorialVideoUrl?: string;
  bilibiliId?: string; // B站视频 BV 号
  bestPlayerCount?: number[]; // 最佳游玩人数（来自桌游吧推荐分组）
  bggId?: string;
  bggUrl?: string;
  knowledgeTier?: 'full' | 'catalog';
  recommendationProfile?: RecommendationProfile;
}

// Chat types
export type ChatMode = 'recommendation' | 'referee';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  gameCard?: Game;
  batchCards?: Game[];
  quickChips?: string[];
  isRefereeMessage?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// User types
export interface User {
  id: string;
  nickname: string;
  avatarUrl?: string;
  favorites: string[];
}

// Scenario tags
export interface ScenarioTag {
  id: string;
  icon: string;
  label: string;
  color: string;
}

// Referee quick chips
export interface RefereeChip {
  id: string;
  label: string;
}
