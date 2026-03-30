// no useState needed
import { Clock, Users, Brain, Baby, ChevronLeft, Heart, Share2, Scale } from 'lucide-react';
import BilibiliPlayer from '@/components/BilibiliPlayer';
import GameCoverImage from '@/components/GameCoverImage';
import { MarkdownText } from '@/components/MarkdownText';
import { mockGames } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface GameDetailPageProps {
  gameId: string;
  onBack: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onEnterRefereeMode: () => void;
}

export default function GameDetailPage({
  gameId,
  onBack,
  isFavorite,
  onToggleFavorite,
  onEnterRefereeMode
}: GameDetailPageProps) {

  const game = mockGames.find(g => g.id === gameId) || mockGames[0];
  const hasFullRulebook = game.knowledgeTier !== 'catalog';

  const handleShare = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?gameId=${game.id}`;
    const shareText = `来【玩吗】看《${game.titleCn}》怎么玩！\n${shareUrl}`;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('链接已复制到剪贴板！\n\n' + shareUrl);
      }).catch(() => {
        alert('复制失败，请手动复制链接');
      });
    } else {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = shareText;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        alert('链接已复制到剪贴板！\n\n' + shareUrl);
      } catch (err) {
        alert('复制失败，请手动复制链接');
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF9F0] pb-24">
      {/* Header - Sticky */}
      <header className="sticky top-0 z-50 bg-[#FFF9F0] border-b-2 border-black safe-top">
        <div className="flex items-center justify-between px-4 py-3">
          <Button
            variant="secondary"
            size="icon"
            onClick={onBack}
            className="w-10 h-10 rounded-xl shrink-0"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h1 className="font-black text-lg line-clamp-1 px-2">{game.titleCn}</h1>
          <div className="flex gap-2 shrink-0">
            <Button
              variant={isFavorite ? "destructive" : "secondary"}
              size="icon"
              onClick={onToggleFavorite}
              className={`w-10 h-10 rounded-xl ${isFavorite ? 'bg-red-500 hover:bg-red-600' : ''}`}
            >
              <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={handleShare}
              className="w-10 h-10 rounded-xl"
            >
              <Share2 className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Cover Image */}
      <div className="relative aspect-[16/9] overflow-hidden border-b-2 border-black">
        <GameCoverImage
          src={game.coverUrl}
          title={game.titleCn}
          subtitle={game.titleEn}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        <div className="absolute bottom-4 left-4 text-white">
          <h2 className="text-2xl font-black drop-shadow-lg">{game.titleCn}</h2>
          <p className="text-sm opacity-90">{game.titleEn}</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Basic Stats - Black & White */}
        <div className="flex gap-2">
          <div className="flex-1 flex flex-col items-center justify-center bg-black text-white py-3 rounded-xl border-2 border-black" style={{ boxShadow: '2px 2px 0 0 black' }}>
            <Users className="w-5 h-5 mb-1" />
            <span className="text-xs font-black">{game.minPlayers}-{game.maxPlayers}人</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center bg-black text-white py-3 rounded-xl border-2 border-black" style={{ boxShadow: '2px 2px 0 0 black' }}>
            <Clock className="w-5 h-5 mb-1" />
            <span className="text-xs font-black">{game.playtimeMin}min</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center bg-black text-white py-3 rounded-xl border-2 border-black" style={{ boxShadow: '2px 2px 0 0 black' }}>
            <Baby className="w-5 h-5 mb-1" />
            <span className="text-xs font-black">{game.ageRating}岁+</span>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center bg-black text-white py-3 rounded-xl border-2 border-black" style={{ boxShadow: '2px 2px 0 0 black' }}>
            <Brain className="w-5 h-5 mb-1" />
            <span className="text-xs font-black">{game.complexity}/5</span>
          </div>
        </div>

        {/* Tags - Horizontal Scroll */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide pt-1 pl-1 -ml-1">
          {game.tags.map((tag, index) => (
            <Badge
              key={index}
              variant="secondary"
              className="shrink-0 rounded-lg text-sm"
            >
              {tag}
            </Badge>
          ))}
        </div>

        {/* One Liner - Yellow Highlight */}
        <div className="bg-[#FFD700] rounded-xl p-4 border-2 border-black shadow-neo">
          <p className="text-sm text-black font-bold italic">"{game.oneLiner}"</p>
        </div>

        {/* 30秒看懂怎么玩 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5 bg-black rounded-full"></div>
            <h3 className="text-lg font-black">{hasFullRulebook ? '30秒看懂怎么玩' : '收录状态'}</h3>
          </div>

          {hasFullRulebook ? (
            <Tabs defaultValue="target" className="w-full">
              <TabsList className="w-full flex mb-4">
                <TabsTrigger value="target" className="flex-1">怎么赢</TabsTrigger>
                <TabsTrigger value="flow" className="flex-1">流程</TabsTrigger>
                <TabsTrigger value="tips" className="flex-1">避坑</TabsTrigger>
              </TabsList>

              <div className="min-h-[160px]">
                <TabsContent value="target" className="mt-0 outline-none">
                  <div className="bg-white rounded-xl p-4 border-2 border-black shadow-neo-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#FFD700] rounded-full blur-3xl opacity-20 -mr-10 -mt-10 pointer-events-none"></div>

                    <div className="relative z-10">
                      <MarkdownText content={game.rules.target} />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="flow" className="mt-0 outline-none">
                  <div className="bg-white rounded-xl p-4 border-2 border-black shadow-neo-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#4169E1] rounded-full blur-3xl opacity-10 -mr-10 -mt-10 pointer-events-none"></div>
                    <div className="relative z-10">
                      <MarkdownText content={game.rules.flow} />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="tips" className="mt-0 outline-none">
                  <div className="bg-white rounded-xl p-4 border-2 border-black shadow-neo-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#FF4444] rounded-full blur-3xl opacity-10 -mr-10 -mt-10 pointer-events-none"></div>

                    <div className="relative z-10">
                      <MarkdownText content={game.rules.tips} />
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            <div className="bg-white rounded-xl p-4 border-2 border-black shadow-neo-sm space-y-3">
              <div className="inline-flex items-center rounded-lg border-2 border-black bg-[#FFD700] px-2 py-1 text-xs font-black text-black">
                推荐目录已收录
              </div>
              <p className="text-sm text-gray-800 font-medium">
                这款游戏已经能参与推荐召回，但本地规则库还在补全中。
              </p>
              <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>现在可以看基础信息和教学视频</li>
                <li>推荐模式会把它作为候选游戏召回</li>
                <li>裁判模式暂不以强规则权威方式开放</li>
              </ul>
            </div>
          )}
        </div>

        {/* Video Section */}
        {game.bilibiliId && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-5 bg-black rounded-full"></div>
              <h3 className="text-lg font-black">教学视频</h3>
            </div>

            <BilibiliPlayer
              bvid={game.bilibiliId}
              title={game.titleCn}
              coverUrl={game.coverUrl}
            />
          </div>
        )}
        {/* Floating AI Referee Button */}
        {hasFullRulebook ? (
          <div className="fixed bottom-6 right-4 z-40">
            <Button
              onClick={onEnterRefereeMode}
              className="rounded-full px-5 py-6 bg-[#4169E1] text-white shadow-neo border-2 border-black hover:-translate-y-1 hover:shadow-neo-hover active:translate-y-0.5 active:shadow-neo-active hover:bg-[#3454b4] text-base gap-2"
            >
              <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center shrink-0">
                <Scale className="w-4 h-4 text-[#4169E1]" />
              </div>
              AI 裁判
            </Button>
          </div>
        ) : null}

      </div >

    </div >
  );
}

// Simple
