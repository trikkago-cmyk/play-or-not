import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

interface GameCoverImageProps {
  src?: string;
  title: string;
  subtitle?: string;
  alt?: string;
  className?: string;
}

export default function GameCoverImage({
  src,
  title,
  subtitle,
  alt,
  className,
}: GameCoverImageProps) {
  const [hasError, setHasError] = useState(false);

  const fallbackLabel = useMemo(() => {
    const trimmed = title.trim();
    if (trimmed.length <= 6) {
      return trimmed;
    }
    return `${trimmed.slice(0, 6)}…`;
  }, [title]);

  if (!src || hasError) {
    return (
      <div
        className={cn(
          'flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_top,_#ffe37a_0%,_#ffd700_35%,_#f59e0b_100%)] p-3 text-center text-black',
          className,
        )}
      >
        <div className="rounded-2xl border-2 border-black bg-white/80 px-3 py-2 shadow-[2px_2px_0_0_black]">
          <div className="text-sm font-black leading-tight">{fallbackLabel}</div>
          {subtitle ? <div className="mt-1 text-[10px] text-black/70">{subtitle}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? title}
      className={className}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  );
}
