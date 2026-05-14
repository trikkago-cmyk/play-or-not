import type {
  ChatMessage,
  ChatMode,
  ChatSession,
  DialogueContextMemory,
  DialogueHistoryEntry,
  DialogueSessionMemory,
  Game,
  RecommendationSessionState,
} from '@/types';

const STORAGE_VERSION = 1;
const SESSIONS_STORAGE_PREFIX = 'play_or_not_chat_sessions_v1';
const CURRENT_SESSION_STORAGE_PREFIX = 'play_or_not_current_session_v1';

interface StoredSessionsPayload {
  version: 1;
  sessions: ChatSession[];
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage ?? null;
}

export function normalizeSessionOwner(ownerKey?: string): string {
  const normalized = ownerKey?.trim().toLowerCase();
  return normalized || 'anonymous';
}

function getSessionsStorageKey(ownerKey?: string): string {
  return `${SESSIONS_STORAGE_PREFIX}:${normalizeSessionOwner(ownerKey)}`;
}

function getCurrentSessionStorageKey(ownerKey?: string): string {
  return `${CURRENT_SESSION_STORAGE_PREFIX}:${normalizeSessionOwner(ownerKey)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function sanitizeRecommendationState(value: unknown): RecommendationSessionState {
  const source = isRecord(value) ? value : {};

  return {
    requestedPlayerCount: typeof source.requestedPlayerCount === 'number' ? source.requestedPlayerCount : undefined,
    requestedPlayerRangeMin: typeof source.requestedPlayerRangeMin === 'number' ? source.requestedPlayerRangeMin : undefined,
    requestedPlayerRangeMax: typeof source.requestedPlayerRangeMax === 'number' ? source.requestedPlayerRangeMax : undefined,
    maxPlaytime: typeof source.maxPlaytime === 'number' ? source.maxPlaytime : undefined,
    minComplexity: typeof source.minComplexity === 'number' ? source.minComplexity : undefined,
    maxComplexity: typeof source.maxComplexity === 'number' ? source.maxComplexity : undefined,
    maxAgeRating: typeof source.maxAgeRating === 'number' ? source.maxAgeRating : undefined,
    desiredTags: asStringArray(source.desiredTags),
    searchTerms: asStringArray(source.searchTerms),
    excludedTags: asStringArray(source.excludedTags),
    excludedTerms: asStringArray(source.excludedTerms),
    sourceTurns: asStringArray(source.sourceTurns).slice(-8),
    lastAction: typeof source.lastAction === 'string'
      ? source.lastAction as RecommendationSessionState['lastAction']
      : undefined,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : undefined,
  };
}

function sanitizeDialogueHistory(value: unknown): DialogueHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => (
      (entry.role === 'user' || entry.role === 'assistant')
      && typeof entry.content === 'string'
      && entry.content.trim().length > 0
    ))
    .map((entry) => ({
      role: entry.role as DialogueHistoryEntry['role'],
      content: entry.content as string,
    }))
    .slice(-20);
}

function sanitizeDialogueContext(value: unknown): DialogueContextMemory {
  const source = isRecord(value) ? value : {};
  const complexity = source.complexity;

  return {
    playerCount: typeof source.playerCount === 'number' ? source.playerCount : undefined,
    scenario: typeof source.scenario === 'string' ? source.scenario : undefined,
    complexity: complexity === 'low' || complexity === 'medium' || complexity === 'high' ? complexity : undefined,
    preferredTags: asStringArray(source.preferredTags),
    mentionedGames: asStringArray(source.mentionedGames),
    recommendationState: sanitizeRecommendationState(source.recommendationState),
    turnCount: typeof source.turnCount === 'number' ? source.turnCount : 0,
    lastQuery: typeof source.lastQuery === 'string' ? source.lastQuery : '',
    history: sanitizeDialogueHistory(source.history),
  };
}

function sanitizeDialogueState(value: unknown): DialogueSessionMemory | undefined {
  if (!isRecord(value) || value.version !== STORAGE_VERSION) {
    return undefined;
  }

  return {
    version: 1,
    sessionGames: asStringArray(value.sessionGames),
    context: sanitizeDialogueContext(value.context),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function sanitizeMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string') {
    return null;
  }

  if (value.role !== 'user' && value.role !== 'assistant' && value.role !== 'system') {
    return null;
  }

  const gameCard = isRecord(value.gameCard) && typeof value.gameCard.id === 'string'
    ? value.gameCard as unknown as Game
    : undefined;
  const batchCards = Array.isArray(value.batchCards)
    ? value.batchCards.filter((game): game is Game => isRecord(game) && typeof game.id === 'string')
    : undefined;

  return {
    id: value.id,
    role: value.role,
    content: value.content,
    timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
    isStreaming: typeof value.isStreaming === 'boolean' ? value.isStreaming : false,
    streamTtsHandled: typeof value.streamTtsHandled === 'boolean' ? value.streamTtsHandled : undefined,
    isRefereeMessage: typeof value.isRefereeMessage === 'boolean' ? value.isRefereeMessage : undefined,
    quickChips: asStringArray(value.quickChips),
    gameCard,
    batchCards,
  };
}

function sanitizeChatSession(value: unknown): ChatSession | null {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return null;
  }

  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt;
  const mode = value.mode === 'referee' ? 'referee' : 'recommendation';
  const activeGameId = typeof value.activeGameId === 'string' ? value.activeGameId : null;
  const messages = Array.isArray(value.messages)
    ? value.messages.map(sanitizeMessage).filter((message): message is ChatMessage => Boolean(message))
    : [];

  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : buildSessionTitle(messages),
    messages,
    createdAt,
    updatedAt,
    mode,
    activeGameId: mode === 'referee' ? activeGameId : null,
    dialogueState: sanitizeDialogueState(value.dialogueState),
  };
}

function safeParsePayload(raw: string | null): StoredSessionsPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.sessions)) {
      return null;
    }

    return {
      version: 1,
      sessions: parsed.sessions
        .map(sanitizeChatSession)
        .filter((session): session is ChatSession => Boolean(session)),
    };
  } catch (error) {
    console.warn('Failed to parse chat session storage', error);
    return null;
  }
}

export function loadChatSessions(ownerKey?: string): ChatSession[] {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }

  const payload = safeParsePayload(storage.getItem(getSessionsStorageKey(ownerKey)));
  return payload?.sessions ?? [];
}

export function saveChatSessions(ownerKey: string | undefined, sessions: ChatSession[]): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  const payload: StoredSessionsPayload = {
    version: 1,
    sessions,
  };

  storage.setItem(getSessionsStorageKey(ownerKey), JSON.stringify(payload));
}

export function loadCurrentSessionId(ownerKey?: string): string {
  const storage = getLocalStorage();
  return storage?.getItem(getCurrentSessionStorageKey(ownerKey)) ?? '';
}

export function saveCurrentSessionId(ownerKey: string | undefined, sessionId: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  if (sessionId) {
    storage.setItem(getCurrentSessionStorageKey(ownerKey), sessionId);
  } else {
    storage.removeItem(getCurrentSessionStorageKey(ownerKey));
  }
}

export function buildSessionTitle(messages: ChatMessage[], fallback = '新对话'): string {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  const titleSource = firstUserMessage?.content.trim() || fallback;
  return titleSource.length > 15 ? `${titleSource.slice(0, 15)}...` : titleSource;
}

export function createChatSession(options: {
  id?: string;
  title?: string;
  messages?: ChatMessage[];
  now?: number;
  mode?: ChatMode;
  activeGameId?: string | null;
  dialogueState?: DialogueSessionMemory;
} = {}): ChatSession {
  const now = options.now ?? Date.now();
  const id = options.id ?? (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`
  );
  const messages = options.messages ?? [];
  const mode = options.mode ?? 'recommendation';

  return {
    id,
    title: options.title ?? buildSessionTitle(messages),
    messages,
    createdAt: now,
    updatedAt: now,
    mode,
    activeGameId: mode === 'referee' ? options.activeGameId ?? null : null,
    dialogueState: options.dialogueState,
  };
}

export function upsertChatSession(sessions: ChatSession[], nextSession: ChatSession): ChatSession[] {
  const existingIndex = sessions.findIndex((session) => session.id === nextSession.id);
  if (existingIndex === -1) {
    return [nextSession, ...sessions];
  }

  return sessions.map((session) => (session.id === nextSession.id ? nextSession : session));
}

export function deleteChatSession(sessions: ChatSession[], sessionId: string): ChatSession[] {
  return sessions.filter((session) => session.id !== sessionId);
}
