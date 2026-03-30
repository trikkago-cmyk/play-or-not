import { useState, useCallback } from 'react';
import type { ChatSession, ChatMessage } from '@/types';
import { mockGames, mockChatSessions, mockUser, scenarioTags, refereeChips } from '@/data/mockData';

// Global store using React hooks
let globalState = {
  currentUser: mockUser,
  games: mockGames,
  chatSessions: mockChatSessions,
  currentSessionId: '1',
  isLoggedIn: false,
};

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(listener => listener());
}

export function useStore() {
  const [, forceUpdate] = useState({});
  
  // Subscribe to global state changes
  const subscribe = useCallback(() => {
    const listener = () => forceUpdate({});
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  
  // Get current session
  const getCurrentSession = useCallback(() => {
    return globalState.chatSessions.find(s => s.id === globalState.currentSessionId);
  }, []);
  
  // Get game by id
  const getGameById = useCallback((id: string) => {
    return globalState.games.find(g => g.id === id);
  }, []);
  
  // Add message to current session
  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const session = globalState.chatSessions.find(s => s.id === globalState.currentSessionId);
    if (session) {
      const newMessage: ChatMessage = {
        ...message,
        id: Date.now().toString(),
        timestamp: Date.now(),
      };
      session.messages.push(newMessage);
      session.updatedAt = Date.now();
      notifyListeners();
    }
  }, []);
  
  // Create new session
  const createNewSession = useCallback(() => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: '新对话',
      messages: [{
        id: '1',
        role: 'assistant',
        content: '嘿！我是你的桌游DM。今天几个人？想玩点什么感觉的？',
        timestamp: Date.now(),
      }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    globalState.chatSessions.unshift(newSession);
    globalState.currentSessionId = newSession.id;
    notifyListeners();
    return newSession;
  }, []);
  
  // Switch session
  const switchSession = useCallback((sessionId: string) => {
    globalState.currentSessionId = sessionId;
    notifyListeners();
  }, []);
  
  // Toggle favorite
  const toggleFavorite = useCallback((gameId: string) => {
    const user = globalState.currentUser;
    const index = user.favorites.indexOf(gameId);
    if (index > -1) {
      user.favorites.splice(index, 1);
    } else {
      user.favorites.push(gameId);
    }
    notifyListeners();
  }, []);
  
  // Check if game is favorite
  const isFavorite = useCallback((gameId: string) => {
    return globalState.currentUser.favorites.includes(gameId);
  }, []);
  
  // Login
  const login = useCallback(() => {
    globalState.isLoggedIn = true;
    notifyListeners();
  }, []);
  
  // Logout
  const logout = useCallback(() => {
    globalState.isLoggedIn = false;
    notifyListeners();
  }, []);
  
  // Get recommendations based on scenario
  const getRecommendations = useCallback((scenario: string) => {
    // Simple recommendation logic based on tags
    const scenarioMap: Record<string, string[]> = {
      '情侣约会': ['策略经营', '轻度策略'],
      '亲子时光': ['经典必玩', '全家欢', '简单易上手'],
      '周末聚会': ['友尽神器', '全程爆笑', '卡牌互坑'],
      '极客烧脑': ['烧脑', '策略经营', '演技大赏'],
      '破冰社交': ['全程爆笑', '拼手速', '反应力'],
    };
    
    const targetTags = scenarioMap[scenario] || [];
    return globalState.games.filter(game => 
      game.tags.some(tag => targetTags.includes(tag))
    );
  }, []);
  
  return {
    user: globalState.currentUser,
    games: globalState.games,
    chatSessions: globalState.chatSessions,
    currentSession: getCurrentSession(),
    isLoggedIn: globalState.isLoggedIn,
    scenarioTags,
    refereeChips,
    subscribe,
    getGameById,
    addMessage,
    createNewSession,
    switchSession,

    toggleFavorite,
    isFavorite,
    login,
    logout,
    getRecommendations,
  };
}
