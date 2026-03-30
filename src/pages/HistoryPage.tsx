import { ChevronLeft, MessageSquare, Trash2, Sparkles } from 'lucide-react';
import type { ChatSession } from '@/types';

interface HistoryPageProps {
  onBack: () => void;
  onNavigateToChat: (sessionId: string) => void;
  sessions: ChatSession[];
}

export default function HistoryPage({ onBack, onNavigateToChat, sessions }: HistoryPageProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - timestamp) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return `${date.getMonth() + 1}-${date.getDate()}`;
    }
  };

  // 生成会话标题
  const getSessionTitle = (session: ChatSession): string => {
    // 使用用户第一句话作为标题
    const firstUserMessage = session.messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const content = firstUserMessage.content;
      // 截取前15个字符作为标题
      if (content.length > 15) {
        return content.slice(0, 15) + '...';
      }
      return content;
    }

    // 默认标题
    return session.title || '新会话';
  };

  // 按时间倒序排序
  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="min-h-screen bg-[#FFF9F0]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#FFF9F0] border-b-2 border-black/5 safe-top">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white border-2 border-black flex items-center justify-center active:translate-y-0.5 transition-transform"
          style={{ boxShadow: '2px 2px 0 0 black' }}
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="font-black text-lg">历史会话</h1>
        <div className="w-10"></div>
      </header>

      <div className="px-4 py-4 safe-bottom">
        {sortedSessions.length > 0 ? (
          <div className="space-y-3">
            {sortedSessions.map((session, index) => {
              const title = getSessionTitle(session);

              return (
                <div
                  key={session.id}
                  onClick={() => onNavigateToChat(session.id)}
                  className="flex items-center justify-between bg-white rounded-xl p-4 border-2 border-black cursor-pointer active:translate-y-0.5 transition-transform animate-slide-up"
                  style={{
                    boxShadow: '3px 3px 0 0 black',
                    animationDelay: `${index * 0.1}s`
                  }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-[#FFD700] border-2 border-black flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-base truncate">{title}</h4>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {formatDate(session.updatedAt)} · {session.messages.length}条消息
                      </p>
                      {session.messages.length > 0 && (
                        <p className="text-xs text-gray-400 mt-1 truncate">
                          {session.messages[session.messages.length - 1].content.slice(0, 25)}...
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      alert('删除会话功能演示');
                    }}
                    className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-red-100 transition-colors flex-shrink-0 ml-2"
                  >
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">暂无历史会话</p>
            <p className="text-sm text-gray-400 mt-1">快去首页开始新的对话吧</p>
          </div>
        )}
      </div>
    </div>
  );
}
