import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatSession } from '@/types';

import {
  buildSessionTitle,
  createChatSession,
  deleteChatSession,
  loadChatSessions,
  loadCurrentSessionId,
  normalizeSessionOwner,
  saveChatSessions,
  saveCurrentSessionId,
  upsertChatSession,
} from '../chatSessionService';

describe('chatSessionService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with no fake demo sessions', () => {
    expect(loadChatSessions('player@example.com')).toEqual([]);
  });

  it('persists sessions by account owner', () => {
    const session = createChatSession({
      id: 'session-a',
      now: 1000,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '六个人，想要轻松聚会',
          timestamp: 1000,
        },
      ],
      dialogueState: {
        version: 1,
        sessionGames: ['just-one'],
        updatedAt: 1000,
        context: {
          playerCount: 6,
          preferredTags: ['聚会'],
          mentionedGames: ['just-one'],
          recommendationState: {
            requestedPlayerCount: 6,
            desiredTags: ['聚会'],
            searchTerms: [],
            excludedTags: [],
            excludedTerms: [],
            sourceTurns: ['六个人，想要轻松聚会'],
          },
          turnCount: 1,
          lastQuery: '六个人，想要轻松聚会',
          history: [{ role: 'user', content: '六个人，想要轻松聚会' }],
        },
      },
    });

    saveChatSessions('player@example.com', [session]);

    const loadedSession = loadChatSessions('player@example.com')[0];
    expect(loadedSession).toMatchObject({
      id: 'session-a',
      title: '六个人，想要轻松聚会',
      messages: [
        expect.objectContaining({
          id: 'm1',
          role: 'user',
          content: '六个人，想要轻松聚会',
        }),
      ],
      dialogueState: expect.objectContaining({
        sessionGames: ['just-one'],
        context: expect.objectContaining({
          playerCount: 6,
          recommendationState: expect.objectContaining({
            requestedPlayerCount: 6,
            desiredTags: ['聚会'],
          }),
        }),
      }),
    });
    expect(loadChatSessions('other@example.com')).toEqual([]);
  });

  it('keeps current session ids scoped by account', () => {
    saveCurrentSessionId('player@example.com', 'session-a');
    saveCurrentSessionId('other@example.com', 'session-b');

    expect(loadCurrentSessionId('player@example.com')).toBe('session-a');
    expect(loadCurrentSessionId('other@example.com')).toBe('session-b');

    saveCurrentSessionId('player@example.com', '');

    expect(loadCurrentSessionId('player@example.com')).toBe('');
  });

  it('builds a stable title from the first user turn', () => {
    expect(buildSessionTitle([
      {
        id: 'hello',
        role: 'assistant',
        content: '嘿！我是你的桌游DM。',
        timestamp: 1,
      },
      {
        id: 'user',
        role: 'user',
        content: '六个人，需要纸笔规划、图图写写的',
        timestamp: 2,
      },
    ])).toBe('六个人，需要纸笔规划、图图写写...');
  });

  it('upserts and deletes real sessions without touching unrelated ones', () => {
    const first = createChatSession({ id: 'first', now: 1 });
    const second = createChatSession({ id: 'second', now: 2 });
    const updatedFirst: ChatSession = {
      ...first,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '换一个',
          timestamp: 3,
        },
      ],
      updatedAt: 3,
    };

    const inserted = upsertChatSession([], first);
    const withSecond = upsertChatSession(inserted, second);
    const updated = upsertChatSession(withSecond, updatedFirst);

    expect(updated).toEqual([second, updatedFirst]);
    expect(deleteChatSession(updated, 'first')).toEqual([second]);
  });

  it('normalizes owner ids for account-level storage keys', () => {
    expect(normalizeSessionOwner(' Player@Example.COM ')).toBe('player@example.com');
    expect(normalizeSessionOwner('')).toBe('anonymous');
  });
});
