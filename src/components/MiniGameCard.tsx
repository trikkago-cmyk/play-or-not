import type { Game } from '@/types';
import GameCoverImage from './GameCoverImage';

interface MiniGameCardProps {
  game: Game;
  onClick: () => void;
}

export default function MiniGameCard({ game, onClick }: MiniGameCardProps) {
  return (
    <div 
      onClick={onClick}
      className="flex-shrink-0 w-36 bg-white rounded-xl border-2 border-black overflow-hidden cursor-pointer active:scale-95 transition-transform"
      style={{ boxShadow: '3px 3px 0 0 black' }}
    >
      {/* Cover */}
      <div className="aspect-square overflow-hidden">
        <GameCoverImage
          src={game.coverUrl}
          title={game.titleCn}
          subtitle={game.titleEn}
          className="w-full h-full object-cover"
        />
      </div>
      
      {/* Info */}
      <div className="p-2">
        <h4 className="font-bold text-sm truncate">{game.titleCn}</h4>
        <p className="text-xs text-gray-500">{game.minPlayers}-{game.maxPlayers}人 · {game.playtimeMin}min</p>
        {game.tags[0] && (
          <span className="inline-block mt-1 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full border border-gray-300">
            {game.tags[0]}
          </span>
        )}
      </div>
    </div>
  );
}
