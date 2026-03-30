import { useState, useRef, useEffect } from 'react';
import { Send, History, User, ChevronLeft, ChevronRight, MessageSquarePlus, Scale, Mic, Volume2, VolumeX } from 'lucide-react';
import type { Game, ChatMessage } from '@/types';
import GameCard from '@/components/GameCard';
import MiniGameCard from '@/components/MiniGameCard';
import { dialogueAgent } from '@/services/ragService';
import { getSimilarGames } from '@/services/ragService';
import { isMockMode, setMockMode, saveLLMConfig, initLLMConfig } from '@/services/llmService';
import { getDmTtsEnabled, hasDmTtsPrimedPlayback, isDmTtsSupported, preloadDmVoices, primeDmTtsPlayback, setDmTtsEnabled, speakAsDm, stopDmTtsPlayback } from '@/services/dmTtsService';
import { mockGames } from '@/data/mockData';
import { MarkdownText } from '@/components/MarkdownText';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
interface ChatPageProps {
  onNavigateToProfile: () => void;
  onNavigateToGameDetail: (gameId: string) => void;
  onNavigateToHistory: () => void;
  initialMessages?: ChatMessage[];
  hasStarted: boolean;
  onMessagesUpdate?: (messages: ChatMessage[]) => void;
  onChatStarted: () => void;
  onNewSession: () => void;
  userAvatar: string;
  targetRefereeGameId?: string | null;
  onRefereeModeEntered?: () => void;
}

const INITIAL_MESSAGE = '嘿！我是你的桌游DM。\n今天几个人？想玩点什么感觉的？';
// 场景标签
const scenarioTags = [
  { icon: '💕', label: '情侣约会' },
  { icon: '👨‍👩‍👧‍👦', label: '亲子时光' },
  { icon: '🎉', label: '周末聚会' },
  { icon: '🧠', label: '极客烧脑' },
  { icon: '🧊', label: '破冰社交' },
];

// 裁判模式快捷问题
const refereeQuestions = [
  { icon: '📖', label: '游戏流程是怎样的？' },
  { icon: '🏁', label: '怎么才算赢？' },
  { icon: '⚔️', label: '平局怎么算？' },
  { icon: '🃏', label: '卡牌有什么特殊效果？' },
  { icon: '👥', label: '人数不同规则有变吗？' },
];

export default function ChatPage({
  onNavigateToProfile,
  onNavigateToGameDetail,
  onNavigateToHistory,
  initialMessages,
  hasStarted,
  onMessagesUpdate,
  onChatStarted,
  onNewSession,
  targetRefereeGameId,
  onRefereeModeEntered
}: ChatPageProps) {
  const [inputValue, setInputValue] = useState('');
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [changeCount, setChangeCount] = useState(0); // Track "换一个" clicks
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [useLLM, setUseLLM] = useState(!isMockMode());
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('deepseek');
  const [ttsEnabled, setTtsEnabled] = useState(() => getDmTtsEnabled());
  const [ttsSupported] = useState(() => isDmTtsSupported());
  const [ttsReplayNonce, setTtsReplayNonce] = useState(0);

  // --- Voice Input States (Backend STT via /api/stt) ---
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const isRecordingRef = useRef(false);
  const isStartingRecordingRef = useRef(false);
  const hasMicPermissionRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const livePreviewRecognitionRef = useRef<any>(null);
  const livePreviewFinalTextRef = useRef('');
  const inputBeforeRecordingRef = useRef('');
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaMimeTypeRef = useRef('');
  // -------------------------------------------

  // 模式状态：推荐模式或裁判模式
  const [mode, setMode] = useState<'recommendation' | 'referee'>('recommendation');
  const [activeGame, setActiveGame] = useState<Game | null>(null);

  // Ref to track if referee mode was already entered for this targetRefereeGameId
  const refereeEnteredRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const spokenAssistantMessageIdsRef = useRef<Set<string>>(
    new Set((initialMessages || []).filter((message) => message.role === 'assistant').map((message) => message.id)),
  );
  const speakingAssistantMessageIdsRef = useRef<Set<string>>(new Set());

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages || []);

  // 初始化LLM配置
  useEffect(() => {
    initLLMConfig();
    setUseLLM(!isMockMode());
  }, []);

  useEffect(() => {
    if (!ttsSupported) {
      return;
    }

    void preloadDmVoices();

    return () => {
      stopDmTtsPlayback();
    };
  }, [ttsSupported]);

  useEffect(() => {
    if (!ttsSupported || !ttsEnabled || hasDmTtsPrimedPlayback()) {
      return;
    }

    const unlockPlayback = () => {
      void primeDmTtsPlayback().then((didPrime) => {
        if (didPrime) {
          setTtsReplayNonce((prev) => prev + 1);
        }
      });
    };

    document.addEventListener('pointerdown', unlockPlayback, true);
    document.addEventListener('touchstart', unlockPlayback, true);
    document.addEventListener('keydown', unlockPlayback, true);

    return () => {
      document.removeEventListener('pointerdown', unlockPlayback, true);
      document.removeEventListener('touchstart', unlockPlayback, true);
      document.removeEventListener('keydown', unlockPlayback, true);
    };
  }, [ttsEnabled, ttsSupported]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 48)}px`;
  }, [inputValue]);

  // 更新Agent的LLM设置
  useEffect(() => {
    dialogueAgent.setUseLLM(useLLM);
  }, [useLLM]);

  useEffect(() => {
    onMessagesUpdate?.(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Typewriter effect - triggered on mount when no messages
  useEffect(() => {
    // Only run if we haven't started AND have no messages (fresh session)
    if (hasStarted) {
      return;
    }

    // If we already have messages (from initialMessages), mark as started
    if (messages.length > 0) {
      onChatStarted();
      return;
    }

    // Show typewriter greeting
    setIsTyping(true);
    setDisplayedText('');
    let index = 0;
    const text = INITIAL_MESSAGE;
    let cancelled = false;

    const typeInterval = setInterval(() => {
      if (cancelled) {
        clearInterval(typeInterval);
        return;
      }
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(typeInterval);
        setIsTyping(false);
        const initialMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        };
        setMessages([initialMsg]);
        onChatStarted();
      }
    }, 30);

    return () => {
      cancelled = true;
      clearInterval(typeInterval);
    };
    // Only run on mount (empty dependency array would cause issues, so we use hasStarted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to handle navigation from GameDetailPage to Referee Mode
  useEffect(() => {
    if (targetRefereeGameId && onRefereeModeEntered) {
      // Use ref to prevent double entry
      if (refereeEnteredRef.current === targetRefereeGameId) {
        onRefereeModeEntered();
        return;
      }

      const game = mockGames.find(g => g.id === targetRefereeGameId);
      if (game) {
        refereeEnteredRef.current = targetRefereeGameId;
        enterRefereeMode(game);
      }
      onRefereeModeEntered();
    }
  }, [targetRefereeGameId, onRefereeModeEntered]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, displayedText]);

  useEffect(() => {
    if (!ttsSupported || !ttsEnabled) {
      return;
    }

    const latestAssistantMessage = [...messages].reverse().find(
      (message) => message.role === 'assistant'
        && !spokenAssistantMessageIdsRef.current.has(message.id)
        && !speakingAssistantMessageIdsRef.current.has(message.id),
    );

    if (!latestAssistantMessage) {
      return;
    }

    speakingAssistantMessageIdsRef.current.add(latestAssistantMessage.id);

    void speakAsDm(latestAssistantMessage.content).then((didSpeak) => {
      speakingAssistantMessageIdsRef.current.delete(latestAssistantMessage.id);
      if (didSpeak) {
        spokenAssistantMessageIdsRef.current.add(latestAssistantMessage.id);
      }
    });
  }, [messages, ttsEnabled, ttsSupported, ttsReplayNonce]);

  // 进入裁判模式
  const enterRefereeMode = (game: Game) => {
    setMode('referee');
    setActiveGame(game);

    // 添加进入裁判模式的胶囊消息 (System Message)
    const systemMessage: ChatMessage = {
      id: "sys-enter-" + Date.now().toString(),
      role: 'system',
      content: `已进入《${game.titleCn}》AI裁判模式`,
      timestamp: Date.now(),
      isRefereeMessage: true,
    };
    setMessages(prev => [...prev, systemMessage]);
  };

  // 退出裁判模式
  const exitRefereeMode = () => {
    setMode('recommendation');
    setActiveGame(null);
    refereeEnteredRef.current = null;

    // 添加退出裁判模式的胶囊消息 (System Message)
    const systemMessage: ChatMessage = {
      id: "sys-exit-" + Date.now().toString(),
      role: 'system',
      content: '已退出裁判模式',
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, systemMessage]);
  };

  // 处理场景标签点击
  const handleScenarioClick = async (scenario: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: scenario,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsProcessing(true);

    const result = await dialogueAgent.processInput(`${scenario} 推荐游戏`, 'recommendation');

    const aiMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: result.answer,
      timestamp: Date.now(),
      gameCard: result.games[0],
    };
    setMessages(prev => [...prev, aiMessage]);
    setIsProcessing(false);
  };

  // 处理裁判模式快捷问题点击
  const handleRefereeQuestionClick = async (question: string) => {
    // 处理退出裁判模式
    if (question === '退出裁判模式') {
      exitRefereeMode();
      return;
    }

    if (!activeGame) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: question,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsProcessing(true);

    const result = await dialogueAgent.processInput(question, 'referee', activeGame);

    const aiMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: result.answer,
      timestamp: Date.now(),
      isRefereeMessage: true,
    };
    setMessages(prev => [...prev, aiMessage]);
    setIsProcessing(false);
  };

  // --- Voice Input Logic (Backend STT via MediaRecorder) ---
  const showMicPermissionHelp = (reason?: string) => {
    const details = reason ? `\n\n原因：${reason}` : '';
    alert(`麦克风权限不可用，请检查：\n1. 当前站点是否为 HTTPS\n2. 浏览器地址栏中的麦克风权限是否已允许\n3. 系统设置中是否已允许浏览器访问麦克风${details}`);
  };

  const stopLivePreview = () => {
    const recognition = livePreviewRecognitionRef.current;
    livePreviewRecognitionRef.current = null;

    if (!recognition) {
      return;
    }

    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;

    try {
      recognition.stop();
    } catch (error) {
      console.warn('Failed to stop live preview recognition:', error);
    }
  };

  const startLivePreview = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    stopLivePreview();

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    livePreviewFinalTextRef.current = '';
    livePreviewRecognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          livePreviewFinalTextRef.current += transcript;
        } else {
          interimText += transcript;
        }
      }

      const nextPreviewText = (livePreviewFinalTextRef.current + interimText).trim();
      if (nextPreviewText) {
        setInputValue(nextPreviewText);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('Live preview recognition unavailable:', event?.error);
      if (livePreviewRecognitionRef.current === recognition) {
        livePreviewRecognitionRef.current = null;
      }
    };

    recognition.onend = () => {
      if (livePreviewRecognitionRef.current === recognition) {
        livePreviewRecognitionRef.current = null;
      }
    };

    try {
      recognition.start();
    } catch (error) {
      console.warn('Failed to start live preview recognition:', error);
      livePreviewRecognitionRef.current = null;
    }
  };

  const cleanupRecordingResources = () => {
    stopLivePreview();

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    mediaMimeTypeRef.current = '';
  };

  const getSupportedRecordingMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/ogg;codecs=opus',
    ];

    return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
  };

  const getAudioExtension = (mimeType: string) => {
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('wav')) return 'wav';
    return 'webm';
  };

  const transcribeRecordedAudio = async (audioBlob: Blob, mimeType: string) => {
    const extension = getAudioExtension(mimeType || audioBlob.type);
    const formData = new FormData();
    formData.append('file', audioBlob, `speech.${extension}`);

    const response = await fetch('/api/stt', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || '语音转写失败，请稍后重试');
    }

    const transcript = typeof payload.text === 'string'
      ? payload.text
      : typeof payload.transcript === 'string'
        ? payload.transcript
        : '';

    return transcript.trim();
  };

  const ensureMicrophonePermission = async () => {
    if (hasMicPermissionRef.current) {
      return true;
    }

    if (!window.isSecureContext) {
      showMicPermissionHelp('语音输入必须在 HTTPS 或 localhost 环境下使用');
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Safari');
      return false;
    }

    try {
      const permissionsApi = (navigator as Navigator & { permissions?: { query: (descriptor: { name: string }) => Promise<{ state?: string }> } }).permissions;
      if (permissionsApi?.query) {
        const permissionStatus = await permissionsApi.query({ name: 'microphone' });
        if (permissionStatus?.state === 'denied') {
          showMicPermissionHelp('浏览器已将本站麦克风权限设为拒绝');
          return false;
        }
      }
    } catch (error) {
      console.warn('Microphone permission preflight skipped:', error);
    }

    return true;
  };

  const startRecording = async () => {
    if (isRecordingRef.current || isStartingRecordingRef.current || isTranscribing) {
      return;
    }

    isStartingRecordingRef.current = true;

    const hasPermission = await ensureMicrophonePermission();
    if (!hasPermission) {
      isStartingRecordingRef.current = false;
      return;
    }

    try {
      inputBeforeRecordingRef.current = inputValue;
      setInputValue('');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
        },
      });

      const mimeType = getSupportedRecordingMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaMimeTypeRef.current = mediaRecorder.mimeType || mimeType || 'audio/webm';

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        cleanupRecordingResources();
        isStartingRecordingRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);
        alert('录音失败，请检查浏览器是否允许站点访问麦克风');
      };

      mediaRecorder.onstop = async () => {
        const recordedMimeType = mediaMimeTypeRef.current || 'audio/webm';
        const previewText = livePreviewFinalTextRef.current.trim();
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recordedMimeType,
        });

        cleanupRecordingResources();
        isStartingRecordingRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);

        if (!audioBlob.size) {
          return;
        }

        setIsTranscribing(true);
        try {
          const transcript = await transcribeRecordedAudio(audioBlob, recordedMimeType);
          if (!transcript) {
            alert('没有识别到清晰语音，请再试一次');
            if (!previewText) {
              setInputValue(inputBeforeRecordingRef.current);
            }
            return;
          }

          setInputValue(transcript);
          inputBeforeRecordingRef.current = '';
          inputRef.current?.focus();
        } catch (error: any) {
          if (!previewText) {
            setInputValue(inputBeforeRecordingRef.current);
          }
          alert(error?.message || '语音转写失败，请稍后重试');
        } finally {
          setIsTranscribing(false);
        }
      };

      startLivePreview();
      mediaRecorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
    } catch (error: any) {
      cleanupRecordingResources();
      isStartingRecordingRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);

      if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
        showMicPermissionHelp('浏览器拒绝了本站访问麦克风');
        return;
      }

      alert(`麦克风初始化失败：${error?.message || error?.name || '未知错误'}`);
    } finally {
      isStartingRecordingRef.current = false;
    }
  };

  const stopRecording = async () => {
    if (isStartingRecordingRef.current && !mediaRecorderRef.current) {
      return;
    }

    if (!isRecordingRef.current || !mediaRecorderRef.current) {
      return;
    }

    const mediaRecorder = mediaRecorderRef.current;
    isRecordingRef.current = false;
    setIsRecording(false);

    stopLivePreview();

    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  };

  const handleMicClick = () => {
    if (isProcessing || isTranscribing) {
      return;
    }

    if (isRecordingRef.current || isRecording || isStartingRecordingRef.current) {
      void stopRecording();
      return;
    }

    void startRecording();
  };

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
      cleanupRecordingResources();
    };
  }, []);
  // ---------------------------------------------------------

  // 处理用户输入
  const handleSend = async (forcedText?: string) => {
    const textToSend = forcedText || inputValue;
    if (!textToSend.trim() || isProcessing) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMessage]);
    if (!forcedText) {
      setInputValue('');
    }
    setIsProcessing(true);

    let result;

    if (mode === 'referee' && activeGame) {
      // 用户明确输入了退出指令
      if (userMessage.content.trim() === '退出裁判模式' || userMessage.content.trim() === '退出') {
        exitRefereeMode();
        setIsProcessing(false);
        return;
      }

      result = await dialogueAgent.processInput(userMessage.content, 'referee', activeGame);

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        isRefereeMessage: true,
      };
      setMessages(prev => [...prev, aiMessage]);

      if (result.switchMode) {
        exitRefereeMode();
      }
    } else {
      // 推荐模式
      result = await dialogueAgent.processInput(userMessage.content, 'recommendation');

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        gameCard: result.games && result.games.length > 0 ? result.games[0] : undefined,
      };
      setMessages(prev => [...prev, aiMessage]);
    }

    setIsProcessing(false);
  };

  // "换一个" - 在对话流中新增一个推荐
  const handleChangeGame = async () => {
    const shownIds = dialogueAgent.getSessionGames();

    if (shownIds.length === 0) return;

    const lastGameId = shownIds[shownIds.length - 1];
    let similarGames = getSimilarGames(lastGameId, shownIds);

    // Initial Fallback: If no similar games, try ANY unshown games
    if (similarGames.length === 0) {
      const allGames = mockGames;
      similarGames = allGames.filter(g => !shownIds.includes(g.id) && g.id !== lastGameId);
    }

    if (similarGames.length > 0) {
      // Pick random one from the candidates to simulate variety
      const newGame = similarGames[Math.floor(Math.random() * similarGames.length)];

      setIsProcessing(true);
      const result = await dialogueAgent.processInput(`换一个，类似${newGame.titleCn}`, 'recommendation');

      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        gameCard: result.games && result.games.length > 0 ? result.games[0] : newGame,
      };
      setMessages(prev => [...prev, aiMessage]);
      // Increment change count - show batch button after 2 changes
      setChangeCount(prev => prev + 1);
      setIsProcessing(false);
    } else {
      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '游戏库里的游戏都推荐一遍啦！\n\n要不我们重置会话，重新聊聊？',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMessage]);
    }
  };

  // "换一批" - 在对话流中新增一批横向卡片
  const handleNextBatch = async () => {
    setIsProcessing(true);
    const shownIds = dialogueAgent.getSessionGames();

    // Get unshown games for the batch
    let availableGames = mockGames.filter(g => !shownIds.includes(g.id));

    // Shuffle and take first 3
    availableGames = availableGames.sort(() => Math.random() - 0.5);
    const batchGames = availableGames.slice(0, 3);

    if (batchGames.length > 0) {
      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '再看看这些推荐：',
        timestamp: Date.now(),
        batchCards: batchGames,
      };
      setMessages(prev => [...prev, aiMessage]);
      // Reset change count after showing batch
      setChangeCount(0);
    } else {
      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '游戏库里的游戏都看过啦！\n\n告诉我你的喜好，我可以重新为你筛选。',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMessage]);
    }
    setIsProcessing(false);
  };

  // 从批量视图中选择一个游戏 - 直接跳转到详情页
  const handleSelectFromBatch = (game: Game) => {
    onNavigateToGameDetail(game.id);
  };

  const handlePlayThis = (gameId: string) => {
    onNavigateToGameDetail(gameId);
  };

  const handleNewSession = () => {
    // Reset agent memory!
    dialogueAgent.reset();

    // Reset referee tracking
    refereeEnteredRef.current = null;

    // Notify parent to create new session ID - this will force remount via key prop
    onNewSession();
  };

  // 切换LLM模式
  const handleToggleLLM = () => {
    const newUseLLM = !useLLM;
    setUseLLM(newUseLLM);
    setMockMode(!newUseLLM);
    saveLLMConfig(apiKey, provider, !newUseLLM);
  };

  // 保存API设置
  const handleSaveSettings = () => {
    const newUseLLM = apiKey.trim().length > 0;
    saveLLMConfig(apiKey, provider, !newUseLLM);
    setUseLLM(newUseLLM);
    setShowSettings(false);
    window.location.reload();
  };

  // 预填充API Key（如果已保存）
  useEffect(() => {
    const savedApiKey = localStorage.getItem('llm_api_key');
    const savedProvider = localStorage.getItem('llm_provider');
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedProvider) setProvider(savedProvider);
  }, []);

  const handleToggleTts = () => {
    const nextEnabled = !ttsEnabled;
    setTtsEnabled(nextEnabled);
    setDmTtsEnabled(nextEnabled);
    if (nextEnabled) {
      void primeDmTtsPlayback().then(() => {
        setTtsReplayNonce((prev) => prev + 1);
      });
    }
  };

  const showTypingIndicator = isTyping && messages.length === 0;
  const lastMessageIndex = messages.length - 1;

  // 根据当前模式获取快捷标签
  const getQuickTags = () => {
    if (mode === 'referee') {
      return [...refereeQuestions, { icon: '🚪', label: '退出裁判模式' }];
    }
    return scenarioTags;
  };

  // 处理快捷标签点击
  const handleQuickTagClick = (tag: { icon: string; label: string }) => {
    if (mode === 'referee') {
      handleRefereeQuestionClick(tag.label);
    } else {
      handleScenarioClick(tag.label);
    }
  };

  // Enhanced Markdown Renderer


  const renderMessage = (message: ChatMessage, idx: number) => {
    if (message.role === 'system') {
      return (
        <div key={message.id} className="flex justify-center my-4 animate-fade-in">
          <div className="bg-gray-200 text-gray-600 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 shadow-sm border border-gray-300">
            {message.content.includes('裁判') ? <Scale className="w-3 h-3" /> : null}
            {message.content}
          </div>
        </div>
      );
    }

    if (message.role === 'assistant') {
      return (
        <div key={message.id} className="animate-fade-in">
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-lg overflow-hidden border-2 border-black flex-shrink-0 bg-black">
              <img
                src="/avatars/dm_luosi.png"
                alt="DM"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1" style={{ maxWidth: 'calc(100% - 40px)' }}>
              <div className={`
                  relative max-w-[85%] p-4 rounded-2xl text-sm font-medium leading-relaxed
                  bg-white text-gray-800 rounded-tl-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]
                `}>
                <MarkdownText content={message.content} />
              </div>

              {/* Game Card */}
              {message.gameCard && (
                <div className="mt-3 -ml-10">
                  <GameCard
                    game={message.gameCard}
                    onPlayThis={() => handlePlayThis(message.gameCard!.id)}
                    onChange={handleChangeGame}
                  />
                </div>
              )}

              {/* Batch Game Cards */}
              {message.batchCards && message.batchCards.length > 0 && (
                <div className="mt-3 -ml-10">
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                    {message.batchCards.map((game) => (
                      <MiniGameCard
                        key={game.id}
                        game={game}
                        onClick={() => handleSelectFromBatch(game)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* In the last message, show "换一批" button after 2 changes */}
              {idx === lastMessageIndex && changeCount >= 2 && !message.batchCards && mode === 'recommendation' && (
                <Button
                  onClick={handleNextBatch}
                  disabled={isProcessing || isTranscribing}
                  variant="outline"
                  className="mt-3 w-full rounded-xl"
                >
                  {isProcessing ? '思考中...' : '换一批看看'}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={message.id} className="animate-fade-in">
        <div className="flex justify-end">
          <div className={`
              relative max-w-[85%] p-4 rounded-2xl text-sm font-medium leading-relaxed
              bg-[#FFD700] text-black rounded-tr-none border-2 border-black
            `}>
            <div className="whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#FFF9F0]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-[#FFF9F0] safe-top transition-colors">
        <div className="flex items-center gap-3">
          {mode === 'referee' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={exitRefereeMode}
              className="-ml-2 shrink-0 rounded-full w-10 h-10"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}

          <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-black bg-black">
            <img
              src="/avatars/dm_luosi.png"
              alt="DM 洛思"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <h1 className="font-black text-lg leading-tight">
              DM 洛思
            </h1>
            <span className={`text-xs font-bold ${mode === 'referee' ? 'text-[#4169E1]' : 'text-gray-500'}`}>
              {mode === 'referee' && activeGame
                ? `${activeGame.titleCn} · 裁判`
                : '别纠结，现在就玩！'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleToggleTts}
            variant="ghost"
            size="icon"
            title={ttsEnabled ? '关闭语音播报' : '开启语音播报'}
            disabled={!ttsSupported}
            className={`rounded-full w-10 h-10 shrink-0 ${
              ttsEnabled
                ? 'text-gray-700 hover:bg-black/5 hover:text-black'
                : 'bg-black/8 text-gray-700 hover:bg-black/12 hover:text-black'
            }`}
          >
            {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </Button>
          {mode === 'recommendation' && (
            <div className="flex gap-2">
              <Button
                onClick={onNavigateToProfile}
                variant="ghost"
                size="icon"
                title="我的档案"
                className="rounded-full w-10 h-10 shrink-0"
              >
                <User className="w-6 h-6" />
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Settings Modal */}
      {
        showSettings && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border-2 border-black p-6 max-w-sm w-full" style={{ boxShadow: '4px 4px 0 0 black' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg">AI设置</h3>
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div>
                    <p className="font-medium">智能AI推荐</p>
                    <p className="text-xs text-gray-500">使用大模型进行对话</p>
                  </div>
                  <button
                    onClick={handleToggleLLM}
                    className={`w-12 h-6 rounded-full transition-colors relative ${useLLM ? 'bg-purple-500' : 'bg-gray-300'
                      }`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${useLLM ? 'translate-x-7' : 'translate-x-1'
                      }`} />
                  </button>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">API提供商</label>
                  <select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm"
                  >
                    <option value="deepseek">DeepSeek</option>
                    <option value="moonshot">Moonshot (Kimi)</option>
                    <option value="siliconflow">SiliconFlow</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">API Key</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="输入你的API Key"
                    className="w-full px-3 py-2 rounded-xl border-2 border-black bg-white text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">API Key仅保存在本地浏览器中</p>
                </div>

                <button
                  onClick={handleSaveSettings}
                  className="w-full py-2 bg-[#FFD700] border-2 border-black rounded-xl text-sm font-bold hover:bg-yellow-400 transition-colors"
                  style={{ boxShadow: '2px 2px 0 0 black' }}
                >
                  保存设置
                </button>

                <p className="text-xs text-gray-500">
                  {useLLM
                    ? '✨ AI模式已开启，DM会使用大模型与你对话，推荐更精准！'
                    : '🎮 本地模式，使用规则引擎推荐游戏'}
                </p>
              </div>
            </div>
          </div>
        )
      }

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Date Badge */}
        <div className="flex justify-center">
          <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
            TODAY {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Messages */}
        {messages.map((message, idx) => renderMessage(message, idx))}

        {/* Processing Indicator */}
        {isProcessing && (
          <div className="flex gap-2 animate-fade-in">
            <div className="w-8 h-8 rounded-lg overflow-hidden border-2 border-black flex-shrink-0 bg-black">
              <img
                src="/avatars/dm_luosi.png"
                alt="DM"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 max-w-[80%]">
              <div className="chat-bubble-dm">
                <p className="text-sm leading-relaxed flex items-center gap-2">
                  <span className="w-2 h-2 bg-black rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <span className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  思考中...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Typing Indicator */}
        {showTypingIndicator && (
          <div className="flex gap-2 animate-fade-in">
            <div className="w-8 h-8 rounded-lg bg-black overflow-hidden border-2 border-black flex-shrink-0">
              <img
                src="/avatars/dm_luosi.png"
                alt="DM"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 max-w-[80%]">
              <div className="chat-bubble-dm">
                <p className="text-sm leading-relaxed whitespace-pre-line">
                  {displayedText}
                  <span className="inline-block w-1.5 h-4 bg-black ml-0.5 animate-pulse"></span>
                </p>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="px-4 py-3 bg-[#FFF9F0] border-t border-gray-200 safe-bottom">
        {/* Quick Chips - Always show if available */}
        <div className="mb-2 -mx-4 px-4 mt-[-6px]">
          <div className="flex gap-2 overflow-x-auto pt-2 pb-2 scrollbar-hide">
            {getQuickTags().map((tag) => (
              <Button
                key={tag.label}
                onClick={() => handleQuickTagClick(tag)}
                disabled={isProcessing || isTranscribing}
                variant={tag.label === '退出裁判模式' ? 'destructive' : 'secondary'}
                className="rounded-full shrink-0"
              >
                <span className="mr-1">{tag.icon}</span>
                {tag.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2">
          <Button
            onClick={handleNewSession}
            disabled={isProcessing || isRecording || isTranscribing}
            size="icon"
            className="h-[48px] w-[48px] shrink-0 rounded-xl bg-white border-2 border-black text-black hover:bg-gray-100 shadow-neo-sm"
            title="发起新会话"
          >
            <MessageSquarePlus className="w-5 h-5" />
          </Button>

          <div className="flex-1 relative">
            <Textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={mode === 'referee' ? '输入规则问题...' : isRecording ? '正在倾听，点击结束' : isTranscribing ? '语音识别中...' : '和谁玩？什么场景？'}
              rows={1}
              disabled={isProcessing || isTranscribing}
              className={`min-h-[48px] shadow-neo-sm focus-visible:ring-[#FFD700] rounded-xl py-3 pr-12 overflow-hidden ${isRecording ? 'border-red-500 ring-1 ring-red-500' : ''}`}
            />
            {isRecording && (
              <button
                type="button"
                onClick={handleMicClick}
                className="absolute inset-0 z-10 rounded-xl cursor-pointer"
                aria-label="结束录音"
                title="正在倾听，点击结束"
              />
            )}
            <Button
              type="button"
              onClick={handleMicClick}
              disabled={isProcessing || isTranscribing}
              variant="ghost"
              size="icon-sm"
              className={`absolute right-3 top-1/2 z-20 h-6 w-6 -translate-y-1/2 p-0 text-black hover:bg-transparent hover:text-black/70 active:-translate-y-1/2 ${isRecording ? 'opacity-90' : ''}`}
              title={isRecording ? '正在倾听，点击结束' : isTranscribing ? '识别中' : '点击开始录音'}
            >
              {isRecording && (
                <>
                  <span className="pointer-events-none absolute inset-0 rounded-full border border-black/60 animate-ping" />
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full border border-black/35 animate-ping"
                    style={{ animationDelay: '300ms' }}
                  />
                </>
              )}
              <Mic className={`w-4 h-4 relative z-10 ${isRecording ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
          <Button
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || isProcessing || isTranscribing}
            size="icon"
            className="h-[48px] w-[48px] shrink-0 rounded-xl bg-[#FFD700] text-black hover:bg-[#ffe44d]"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>

        {/* History Link */}
        <div className="flex justify-center mt-3">
          <Button
            variant="ghost"
            onClick={onNavigateToHistory}
            className="text-xs text-gray-500 gap-1 h-8 px-2 rounded-full"
          >
            <History className="w-3.5 h-3.5" />
            查看历史对话
          </Button>
        </div>
      </div>
    </div>
  );
}
