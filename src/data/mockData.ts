import type { ChatSession, User } from '@/types';
import { GAME_DATABASE, SCENARIO_CHIPS, REFEREE_CHIPS } from './gameDatabase';

// 导出游戏数据库
export const mockGames = GAME_DATABASE;

// 导出场景标签
export const scenarioTags = SCENARIO_CHIPS.map((label, index) => ({
  id: String(index + 1),
  icon: ['💕', '👨‍👩‍👧‍👦', '🎉', '🧠', '🧊'][index] || '🎮',
  label,
  color: '#FFD700'
}));

// 导出裁判快捷问题
export const refereeChips = REFEREE_CHIPS;

// 导出场景推荐函数
export { searchGames } from './gameDatabase';

// 模拟聊天会话
export const mockChatSessions: ChatSession[] = [
  {
    id: '1',
    title: '5人破冰局',
    messages: [
      {
        id: '1',
        role: 'assistant',
        content: '嘿！我是你的桌游DM。\n今天几个人？想玩点什么感觉的？',
        timestamp: Date.now() - 3600000,
      },
      {
        id: '2',
        role: 'user',
        content: '破冰社交',
        timestamp: Date.now() - 3500000,
      },
      {
        id: '3',
        role: 'assistant',
        content: '没问题！破冰神器非它莫属，保证大家瞬间熟络起来：',
        timestamp: Date.now() - 3400000,
      }
    ],
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3400000,
  },
  {
    id: '2',
    title: '情侣约会',
    messages: [
      {
        id: '1',
        role: 'assistant',
        content: '嘿！我是你的桌游DM。\n今天几个人？想玩点什么感觉的？',
        timestamp: Date.now() - 86400000,
      }
    ],
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  }
];

// 模拟用户
export const mockUser: User = {
  id: '1',
  nickname: '桌游爱好者',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=boardgame',
  favorites: ['halli-galli', 'avalon'],
};
