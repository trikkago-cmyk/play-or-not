import { useState, useEffect } from 'react';
import LoginPage from '@/pages/LoginPage';
import ChatPage from '@/pages/ChatPage';
import GameDetailPage from '@/pages/GameDetailPage';
import ProfilePage from '@/pages/ProfilePage';
import HistoryPage from '@/pages/HistoryPage';
import type { ChatMessage, ChatMode, ChatSession, DialogueSessionMemory } from '@/types';
import { mockGames } from '@/data/mockData';
import {
  getUserMemory,
  recordGameLike,
  recordGameUnlike,
  replaceUserMemory,
  setActiveMemoryOwner,
} from '@/services/memoryService';
import { getAuthSession, logout } from '@/services/authService';
import {
  buildSessionTitle,
  createChatSession,
  deleteChatSession,
  loadChatSessions,
  loadCurrentSessionId,
  saveChatSessions,
  saveCurrentSessionId,
  upsertChatSession,
} from '@/services/chatSessionService';
import { dialogueAgent } from '@/services/ragService';
import { fetchRemoteUserData, saveRemoteUserData } from '@/services/userDataService';

type PageType = 'login' | 'chat' | 'gameDetail' | 'profile' | 'history';
const DEFAULT_AVATAR = '/avatars/user_1.png';

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('login');
  const [selectedGameId, setSelectedGameId] = useState<string>('');
  const [favoriteIds, setFavoriteIds] = useState<string[]>(['1', '2']);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [userEmail, setUserEmail] = useState('');

  // Sessions state - real per-account chat sessions persisted locally.
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [hasLoadedSessions, setHasLoadedSessions] = useState(false);

  // Current session messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasStarted, setHasStarted] = useState(false);

  // User avatar
  const [userAvatar, setUserAvatar] = useState<string>('');

  // Target game for referee mode when navigating from GameDetail
  const [targetRefereeGameId, setTargetRefereeGameId] = useState<string | null>(null);
  const [memorySyncNonce, setMemorySyncNonce] = useState(0);

  const applyAccountData = (owner: string, loadedSessions: ChatSession[], preferredSessionId = '') => {
    const selectedSession = loadedSessions.find((item) => item.id === preferredSessionId) ?? loadedSessions[0];

    setSessions(loadedSessions);
    setCurrentSessionId(selectedSession?.id ?? '');
    setMessages(selectedSession?.messages ?? []);
    setHasStarted(Boolean(selectedSession && selectedSession.messages.length > 0));
    dialogueAgent.restoreSnapshot(selectedSession?.dialogueState);

    saveChatSessions(owner, loadedSessions);
    saveCurrentSessionId(owner, selectedSession?.id ?? '');
  };

  const hydrateAccountData = async (owner: string) => {
    setActiveMemoryOwner(owner);

    const localSessions = loadChatSessions(owner);
    const localCurrentSessionId = loadCurrentSessionId(owner);
    const localMemory = getUserMemory(owner);

    try {
      const remote = await fetchRemoteUserData();
      if (remote.ok && remote.data) {
        const hasRemoteSessions = remote.data.sessions.length > 0;
        const hasLocalSessions = localSessions.length > 0;

        if (!hasRemoteSessions && hasLocalSessions) {
          applyAccountData(owner, localSessions, localCurrentSessionId);
          void saveRemoteUserData({
            sessions: localSessions,
            currentSessionId: localCurrentSessionId,
            memory: localMemory,
          });
        } else {
          replaceUserMemory(remote.data.memory ?? localMemory, owner);
          applyAccountData(owner, remote.data.sessions, remote.data.currentSessionId);
        }
        return;
      }

      console.warn('Remote user data unavailable, using local fallback:', remote.code || remote.error);
    } catch (error) {
      console.warn('Failed to load remote user data, using local fallback:', error);
    }

    applyAccountData(owner, localSessions, localCurrentSessionId);
  };

  useEffect(() => {
    const savedAvatar = localStorage.getItem('wanma_avatar');
    setUserAvatar(savedAvatar || DEFAULT_AVATAR);

    const params = new URLSearchParams(window.location.search);
    const gameIdFromUrl = params.get('gameId');

    let isCancelled = false;

    async function bootstrap() {
      try {
        const session = await getAuthSession();
        if (isCancelled) {
          return;
        }

        if (session.authenticated) {
          const owner = session.user?.email || '';
          setIsAuthenticated(true);
          setUserEmail(owner);
          await hydrateAccountData(owner);
          setHasLoadedSessions(true);
          if (!gameIdFromUrl) {
            setCurrentPage('chat');
          }
        } else if (!gameIdFromUrl) {
          setCurrentPage('login');
        }
      } catch {
        if (!isCancelled) {
          if (!gameIdFromUrl) {
            setCurrentPage('login');
          }
        }
      } finally {
        if (!isCancelled) {
          if (gameIdFromUrl) {
            setSelectedGameId(gameIdFromUrl);
            setCurrentPage('gameDetail');
          }
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userEmail || !hasLoadedSessions) {
      return;
    }

    saveChatSessions(userEmail, sessions);
    saveCurrentSessionId(userEmail, currentSessionId);
  }, [currentSessionId, hasLoadedSessions, isAuthenticated, sessions, userEmail]);

  useEffect(() => {
    if (!isAuthenticated || !userEmail || !hasLoadedSessions) {
      return;
    }

    void saveRemoteUserData({
      sessions,
      currentSessionId,
      memory: getUserMemory(userEmail),
    }).then((response) => {
      if (!response.ok) {
        console.warn('Remote user data save failed:', response.code || response.error);
      }
    }).catch((error) => {
      console.warn('Remote user data save failed:', error);
    });
  }, [currentSessionId, hasLoadedSessions, isAuthenticated, memorySyncNonce, sessions, userEmail]);

  const handleLogin = (email: string) => {
    setIsAuthenticated(true);
    setUserEmail(email);
    setHasLoadedSessions(false);
    void hydrateAccountData(email).finally(() => {
      setHasLoadedSessions(true);
    });
    const savedAvatar = localStorage.getItem('wanma_avatar');
    setUserAvatar(savedAvatar || DEFAULT_AVATAR);
    setCurrentPage('chat');
  };

  const handleLogout = async () => {
    await logout().catch(() => null);
    localStorage.removeItem('wanma_avatar');
    setSessions([]);
    setCurrentSessionId('');
    setHasLoadedSessions(false);
    setMessages([]);
    setHasStarted(false);
    setUserEmail('');
    setActiveMemoryOwner();
    setIsAuthenticated(false);
    setUserAvatar(DEFAULT_AVATAR);
    setCurrentPage('login');
  };

  const handleNavigateToGameDetail = (gameId: string) => {
    setSelectedGameId(gameId);
    setCurrentPage('gameDetail');
  };

  const handleNavigateToProfile = () => {
    setCurrentPage('profile');
  };

  const handleNavigateToHistory = () => {
    setCurrentPage('history');
  };

  const handleNavigateToChat = (sessionId?: string) => {
    if (sessionId) {
      // Load the selected session's messages
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        setCurrentSessionId(sessionId);
        setMessages(session.messages);
        setHasStarted(session.messages.length > 0);
        dialogueAgent.restoreSnapshot(session.dialogueState);
      }
    }
    setCurrentPage('chat');
  };

  const handleToggleFavorite = (gameId: string) => {
    setFavoriteIds(prev => {
      const isRemoving = prev.includes(gameId);
      const gameTarget = mockGames.find(g => g.id === gameId);

      if (isRemoving) {
        if (gameTarget) recordGameUnlike(gameTarget, userEmail);
        setMemorySyncNonce(prevNonce => prevNonce + 1);
        return prev.filter(id => id !== gameId);
      } else {
        if (gameTarget) recordGameLike(gameTarget, userEmail);
        setMemorySyncNonce(prevNonce => prevNonce + 1);
        return [...prev, gameId];
      }
    });
  };

  const isFavorite = (gameId: string) => favoriteIds.includes(gameId);

  // Handle new session - create a new empty session
  const handleNewSession = () => {
    // First reset all state synchronously
    setMessages([]);
    setHasStarted(false);

    // Then create new session with new ID (this will trigger remount via key)
    const newSession = createChatSession({
      title: '新对话',
      dialogueState: dialogueAgent.getSnapshot(),
    });
    setSessions(prev => upsertChatSession(prev, newSession));

    // Set new session ID last - this triggers the ChatPage remount
    setCurrentSessionId(newSession.id);
  };

  // Handle messages update from ChatPage
  const handleMessagesUpdate = (newMessages: ChatMessage[]) => {
    setMessages(newMessages);

    // If no current session, create one
    if (!currentSessionId) {
      const newSession = createChatSession({
        title: buildSessionTitle(newMessages),
        messages: newMessages,
        dialogueState: dialogueAgent.getSnapshot(),
      });
      setSessions(prev => upsertChatSession(prev, newSession));
      setCurrentSessionId(newSession.id);
    } else {
      // Update the current session in sessions array
      setSessions(prev => {
        const existingSession = prev.find(session => session.id === currentSessionId);
        const nextSession: ChatSession = {
          ...(existingSession ?? createChatSession({ id: currentSessionId })),
          title: buildSessionTitle(newMessages, existingSession?.title || '新对话'),
          messages: newMessages,
          updatedAt: Date.now(),
          dialogueState: existingSession?.dialogueState ?? dialogueAgent.getSnapshot(),
        };

        return upsertChatSession(prev, nextSession);
      });
    }
  };

  const handleSessionMemoryUpdate = (updates: {
    dialogueState?: DialogueSessionMemory;
    mode?: ChatMode;
    activeGameId?: string | null;
  }) => {
    if (!currentSessionId) {
      return;
    }

    setSessions(prev => prev.map(session =>
      session.id === currentSessionId
        ? {
          ...session,
          ...updates,
          updatedAt: Date.now(),
        }
        : session
    ));
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions(prev => deleteChatSession(prev, sessionId));

    if (sessionId === currentSessionId) {
      setCurrentSessionId('');
      setMessages([]);
      setHasStarted(false);
      dialogueAgent.reset();
    }
  };

  // Handle chat started
  const handleChatStarted = () => {
    setHasStarted(true);
  };

  // Render current page
  const renderPage = () => {
    if (isBootstrapping) {
      return (
        <div className="min-h-screen bg-[#FFF9F0] flex flex-col items-center justify-center px-6 py-8 safe-top safe-bottom">
          <div className="w-16 h-16 rounded-2xl bg-white border-2 border-black flex items-center justify-center shadow-neo mb-4">
            <span className="text-xl font-black">DM</span>
          </div>
          <p className="text-base font-bold text-black">正在检查登录状态...</p>
          <p className="text-sm text-gray-500 mt-2">马上进入桌游 DM</p>
        </div>
      );
    }

    switch (currentPage) {
      case 'login':
        return <LoginPage onLogin={handleLogin} />;

      case 'chat':
        if (!isAuthenticated) {
          return <LoginPage onLogin={handleLogin} />;
        }
        const currentSession = sessions.find((session) => session.id === currentSessionId);
        return (
          <ChatPage
            key={currentSessionId} // Force remount on session change
            onNavigateToProfile={handleNavigateToProfile}
            onNavigateToGameDetail={(id) => handleNavigateToGameDetail(id)}
            onNavigateToHistory={handleNavigateToHistory}
            initialMessages={messages}
            initialMode={currentSession?.mode}
            initialActiveGameId={currentSession?.activeGameId}
            initialDialogueState={currentSession?.dialogueState}
            hasStarted={hasStarted}
            onMessagesUpdate={handleMessagesUpdate}
            onSessionMemoryUpdate={handleSessionMemoryUpdate}
            onChatStarted={handleChatStarted}
            onNewSession={handleNewSession}
            userAvatar={userAvatar}
            targetRefereeGameId={targetRefereeGameId}
            onRefereeModeEntered={() => setTargetRefereeGameId(null)}
          />
        );

      case 'gameDetail':
        return (
          <GameDetailPage
            gameId={selectedGameId}
            onBack={() => setCurrentPage(isAuthenticated ? 'chat' : 'login')}
            isFavorite={isFavorite(selectedGameId)}
            onToggleFavorite={() => handleToggleFavorite(selectedGameId)}
            onEnterRefereeMode={() => {
              // We need to signal ChatPage to enter referee mode for this game
              // Since ChatPage state is internal, we might need to lift state up or use a ref/context
              // But for now, let's just navigate to chat. 
              // Wait, ChatPage manages 'mode'. If we render ChatPage, it defaults to recommendation.
              // We need a way to tell ChatPage "Start in Referee Mode for Game X".
              // Let's add an 'initialMode' or 'targetGame' prop to ChatPage, OR
              // Lift 'mode' and 'activeGame' state to App.tsx. 
              // Lifting state is safer.

              // However, to minimize refactor, let's modify ChatPage to accept an 'initialRefereeGame' prop?
              // No, because ChatPage is mounted/unmounted or kept alive?
              // In this conditional render `case 'chat'`, it might be re-mounted.
              // Let's check if ChatPage relies on internal state for mode.
              // Yes it does: const [mode, setMode] = useState<'recommendation' | 'referee'>('recommendation');

              // We will pass `initialRefereeGameId` to ChatPage.
              // And we need to set state in App to pass it down.
              setTargetRefereeGameId(selectedGameId);
              setCurrentPage('chat');
            }}
          />
        );

      case 'profile':
        return (
          <ProfilePage
            onBack={() => setCurrentPage('chat')}
            onNavigateToGameDetail={handleNavigateToGameDetail}
            onLogout={handleLogout}
            favoriteIds={favoriteIds}
            userAvatar={userAvatar}
            userEmail={userEmail}
          />
        );

      case 'history':
        return (
          <HistoryPage
            onBack={() => setCurrentPage('chat')}
            onNavigateToChat={handleNavigateToChat}
            onDeleteSession={handleDeleteSession}
            sessions={sessions}
          />
        );

      default:
        return <LoginPage onLogin={handleLogin} />;
    }
  };

  return (
    <div className="mobile-container">
      {renderPage()}
    </div>
  );
}

export default App;
