import type { Game } from '@/types';
import { buildRecommendationProfile } from './recommendationProfile';

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(value => value?.trim()).filter(Boolean) as string[]));
}

function pickLongerText(current?: string, incoming?: string): string {
  const currentValue = current?.trim() ?? '';
  const incomingValue = incoming?.trim() ?? '';
  return incomingValue.length > currentValue.length ? incomingValue : currentValue;
}

function pickCoverUrl(current?: string, incoming?: string): string {
  if (!current) return incoming ?? '';
  if (!incoming) return current;

  const currentLooksFragile = current.includes('__itemrep');
  const incomingLooksStable = !incoming.includes('__itemrep');

  if (currentLooksFragile && incomingLooksStable) {
    return incoming;
  }

  return current;
}

function mergeRules(current: Game['rules'], incoming: Game['rules']): Game['rules'] {
  return {
    target: pickLongerText(current?.target, incoming?.target),
    flow: pickLongerText(current?.flow, incoming?.flow),
    tips: pickLongerText(current?.tips, incoming?.tips),
  };
}

function mergeGames(current: Game, incoming: Game): Game {
  const aliasTags = uniqueStrings([
    current.titleCn !== incoming.titleCn ? incoming.titleCn : undefined,
    current.titleEn !== incoming.titleEn ? incoming.titleEn : undefined,
  ]);
  const currentTier = current.knowledgeTier ?? (current.knowledgeBase?.trim() ? 'full' : 'catalog');
  const incomingTier = incoming.knowledgeTier ?? (incoming.knowledgeBase?.trim() ? 'full' : 'catalog');

  return {
    ...current,
    coverUrl: pickCoverUrl(current.coverUrl, incoming.coverUrl),
    minPlayers: Math.min(current.minPlayers, incoming.minPlayers),
    maxPlayers: Math.max(current.maxPlayers, incoming.maxPlayers),
    playtimeMin: Math.max(current.playtimeMin, incoming.playtimeMin),
    ageRating: Math.min(current.ageRating, incoming.ageRating),
    complexity: Math.max(current.complexity, incoming.complexity),
    tags: uniqueStrings([...current.tags, ...incoming.tags, ...aliasTags]),
    oneLiner: pickLongerText(current.oneLiner, incoming.oneLiner),
    rules: mergeRules(current.rules, incoming.rules),
    FAQ: pickLongerText(current.FAQ, incoming.FAQ),
    commonQuestions: uniqueStrings([...(current.commonQuestions ?? []), ...(incoming.commonQuestions ?? [])]),
    knowledgeBase: pickLongerText(current.knowledgeBase, incoming.knowledgeBase),
    tutorialVideoUrl: pickLongerText(current.tutorialVideoUrl, incoming.tutorialVideoUrl),
    bilibiliId: pickLongerText(current.bilibiliId, incoming.bilibiliId),
    bestPlayerCount: Array.from(new Set([...(current.bestPlayerCount ?? []), ...(incoming.bestPlayerCount ?? [])])).sort((a, b) => a - b),
    bggId: pickLongerText(current.bggId, incoming.bggId),
    bggUrl: pickLongerText(current.bggUrl, incoming.bggUrl),
    knowledgeTier: currentTier === 'full' || incomingTier === 'full' ? 'full' : 'catalog',
  };
}

export function normalizeGameDatabase(games: Game[]): Game[] {
  const gameMap = new Map<string, Game>();

  for (const game of games) {
    const existingGame = gameMap.get(game.id);

    if (!existingGame) {
      gameMap.set(game.id, {
        ...game,
        tags: uniqueStrings(game.tags),
        commonQuestions: uniqueStrings(game.commonQuestions ?? []),
        bestPlayerCount: Array.from(new Set(game.bestPlayerCount ?? [])).sort((a, b) => a - b),
        knowledgeTier: game.knowledgeTier ?? (game.knowledgeBase?.trim() ? 'full' : 'catalog'),
      });
      continue;
    }

    gameMap.set(game.id, mergeGames(existingGame, game));
  }

  return Array.from(gameMap.values()).map((game) => ({
    ...game,
    tags: uniqueStrings(game.tags),
    commonQuestions: uniqueStrings(game.commonQuestions ?? []),
    bestPlayerCount: Array.from(new Set(game.bestPlayerCount ?? [])).sort((a, b) => a - b),
    knowledgeTier: game.knowledgeTier ?? (game.knowledgeBase?.trim() ? 'full' : 'catalog'),
    recommendationProfile: buildRecommendationProfile(game),
  }));
}
