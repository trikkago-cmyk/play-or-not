import { GAME_DATABASE } from '@/data/gameDatabase';
import type { Game } from '@/types';

const MANUAL_TITLE_ALIASES: Record<string, string[]> = {
  codenames: ['机密代号'],
  dobble: ['嗒宝'],
};

export function normalizeGameLookupTitle(title: string): string {
  return title
    .replace(/[《》【】]/g, '')
    .replace(/[\(（].*?[\)）]/g, '')
    .replace(/[：:·・\-\s_，,。.!！?？]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

export function hasLocalizedGameTitle(game: Pick<Game, 'titleCn' | 'titleEn'>): boolean {
  const titleCn = game.titleCn.trim();
  if (!titleCn) {
    return false;
  }

  if (/[\u4e00-\u9fff]/.test(titleCn)) {
    return true;
  }

  return normalizeGameLookupTitle(titleCn) !== normalizeGameLookupTitle(game.titleEn);
}

export function shouldShowEnglishSubtitle(game: Pick<Game, 'titleCn' | 'titleEn'>): boolean {
  return normalizeGameLookupTitle(game.titleCn) !== normalizeGameLookupTitle(game.titleEn);
}

function getGameTitleAliases(game: Game): string[] {
  const aliases = [
    game.titleCn,
    game.titleEn,
    game.titleCn.replace(/[《》【】]/g, '').trim(),
    game.titleEn.replace(/[《》【】]/g, '').trim(),
    ...(MANUAL_TITLE_ALIASES[game.id] ?? []),
  ];

  return Array.from(new Set(aliases.map((alias) => alias.trim()).filter(Boolean)));
}

export function resolveMentionedGameInText(text: string, excludedGameId?: string): Game | null {
  const normalizedText = normalizeGameLookupTitle(text);
  if (!normalizedText) {
    return null;
  }

  for (const game of GAME_DATABASE) {
    if (game.id === excludedGameId) {
      continue;
    }

    const matched = getGameTitleAliases(game).some((alias) => {
      const normalizedAlias = normalizeGameLookupTitle(alias);
      return normalizedAlias.length >= 2 && normalizedText.includes(normalizedAlias);
    });

    if (matched) {
      return game;
    }
  }

  return null;
}
