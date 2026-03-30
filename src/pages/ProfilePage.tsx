import { ChevronLeft, Heart, LogOut } from 'lucide-react';
import GameCoverImage from '@/components/GameCoverImage';
import { mockGames } from '@/data/mockData';

interface ProfilePageProps {
  onBack: () => void;
  onNavigateToGameDetail: (gameId: string) => void;
  onLogout: () => void;
  favoriteIds: string[];
  userAvatar: string;
  userEmail: string;
}

export default function ProfilePage({
  onBack,
  onNavigateToGameDetail,
  onLogout,
  favoriteIds,
  userAvatar,
  userEmail,
}: ProfilePageProps) {
  const favoriteGames = mockGames.filter(g => favoriteIds.includes(g.id));

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
        <h1 className="font-black text-lg">我的</h1>
        <div className="w-10"></div>
      </header>

      <div className="px-4 py-6 space-y-6 safe-bottom">
        {/* User Info */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white border-2 border-black overflow-hidden card-shadow-sm">
            {userAvatar ? (
              <img
                src={userAvatar}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                <span className="text-2xl">👤</span>
              </div>
            )}
          </div>
          <div>
            <h2 className="text-xl font-black">桌游爱好者</h2>
            <p className="text-sm text-gray-500">{userEmail || '暂未绑定邮箱'}</p>
          </div>
        </div>

        {/* Favorites Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-5 h-5 text-red-500" />
            <h3 className="text-lg font-black">我喜欢的</h3>
          </div>

          {favoriteGames.length > 0 ? (
            <div className="space-y-3">
              {favoriteGames.map(game => (
                <div
                  key={game.id}
                  onClick={() => onNavigateToGameDetail(game.id)}
                  className="flex items-center gap-3 bg-white rounded-xl p-3 border-2 border-black cursor-pointer active:translate-y-0.5 transition-transform"
                  style={{ boxShadow: '3px 3px 0 0 black' }}
                >
                  <GameCoverImage
                    src={game.coverUrl}
                    title={game.titleCn}
                    subtitle={game.titleEn}
                    className="w-16 h-16 rounded-lg object-cover border-2 border-black"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold truncate">{game.titleCn}</h4>
                    <p className="text-xs text-gray-500">{game.titleEn}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{game.minPlayers}-{game.maxPlayers}人</span>
                      <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">{game.playtimeMin}min</span>
                    </div>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-8 border-2 border-black text-center card-shadow-sm">
              <Heart className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">还没收藏过游戏呢</p>
              <p className="text-sm text-gray-400 mt-1">去首页发现好玩的桌游吧</p>
            </div>
          )}
        </div>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          className="w-full py-4 rounded-xl bg-gray-100 text-gray-600 font-bold border-2 border-gray-300 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          退出登录
        </button>
      </div>
    </div>
  );
}
