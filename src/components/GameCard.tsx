import { Users, Clock, Baby, Brain, Crown } from 'lucide-react';
import type { Game } from '@/types';
import GameCoverImage from './GameCoverImage';

interface GameCardProps {
  game: Game;
  onPlayThis: () => void;
  onChange: () => void;
  // onReferee?: () => void;
}

export default function GameCard({ game, onPlayThis, onChange }: GameCardProps) {
  return (
    <div className="game-card animate-slide-up">
      {/* Cover Image */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <GameCoverImage
          src={game.coverUrl}
          title={game.titleCn}
          subtitle={game.titleEn}
          className="w-full h-full object-cover"
        />
        {/* Best Match Badge */}
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-[#FFD700] px-2 py-0.5 rounded-lg border-2 border-black">
          <Crown className="w-3 h-3" />
          <span className="text-[10px] font-bold">最佳推荐</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Title */}
        <h3 className="text-lg font-black text-black">{game.titleCn}</h3>
        <p className="text-[10px] text-gray-500 mb-2">{game.titleEn}</p>

        {/* Stats - Single Row */}
        <div className="flex gap-2 mb-2">
          <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg text-[10px]">
            <Users className="w-3 h-3" />
            <span>{game.minPlayers}-{game.maxPlayers}人</span>
          </div>
          <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg text-[10px]">
            <Clock className="w-3 h-3" />
            <span>{game.playtimeMin}min</span>
          </div>
          <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg text-[10px]">
            <Baby className="w-3 h-3" />
            <span>{game.ageRating}岁+</span>
          </div>
          <div className="flex items-center gap-1 bg-black text-white px-2 py-0.5 rounded-lg text-[10px]">
            <Brain className="w-3 h-3" />
            <span>{game.complexity}/5</span>
          </div>
        </div>

        {/* Tags - Full Width */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {game.tags.map((tag, index) => (
            <span
              key={index}
              className="text-xs font-bold px-2 py-1 rounded-full border-2 border-black bg-white"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* One Liner - Quote Style */}
        <div className="mb-3 pl-3 border-l-4 border-[#FFD700]">
          <p className="text-xs text-gray-700 font-medium italic">"{game.oneLiner}"</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onPlayThis}
            className="flex-1 py-2 rounded-xl bg-[#FFD700] text-black font-black text-sm border-2 border-black active:translate-y-0.5 transition-transform"
            style={{ boxShadow: '2px 2px 0 0 black' }}
          >
            就玩这个
          </button>
          <button
            onClick={onChange}
            className="flex-1 py-2 rounded-xl bg-white text-gray-600 font-bold text-sm border-2 border-black hover:border-black transition-colors"
            style={{ boxShadow: '2px 2px 0 0 black' }}
          >
            换一个
          </button>
        </div>



        {/* AI Referee Button */}

      </div>
    </div>
  );
}
