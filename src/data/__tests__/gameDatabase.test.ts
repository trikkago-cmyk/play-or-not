import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { GAME_DATABASE } from '../gameDatabase';
import { GAME_DATABASE_AUTO_EXPANSION } from '../gameDatabaseAutoExpansion';
import { GAME_DATABASE_CATALOG_EXPANSION } from '../gameDatabaseCatalogExpansion';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CJK_TITLE_PATTERN = /[\u3400-\u9fff]/;

describe('gameDatabase cover completeness', () => {
  it('ensures every merged game entry points to a localized coverUrl', () => {
    const invalidCoverGames = GAME_DATABASE.filter(
      (game) => !game.coverUrl || !game.coverUrl.trim() || !game.coverUrl.startsWith('/game-covers/'),
    ).map((game) => ({
      id: game.id,
      titleCn: game.titleCn,
      coverUrl: game.coverUrl,
    }));

    expect(invalidCoverGames).toEqual([]);
  });

  it('ensures shipped svg covers are real assets instead of generated fallback posters', () => {
    const placeholderSvgGames = GAME_DATABASE.filter((game) => game.coverUrl.endsWith('.svg')).filter((game) => {
      const absolutePath = path.resolve(__dirname, '../../../public', game.coverUrl.slice(1));
      const payload = fs.readFileSync(absolutePath, 'utf8');
      return payload.includes('Auto-generated local fallback');
    }).map((game) => ({
      id: game.id,
      titleCn: game.titleCn,
      coverUrl: game.coverUrl,
    }));

    expect(placeholderSvgGames).toEqual([]);
  });
});

describe('gameDatabase localization and referee readiness', () => {
  it('uses the accepted Chinese title for Blood on the Clocktower', () => {
    const clocktower = GAME_DATABASE.find((game) => game.id === 'blood-on-the-clocktower');

    expect(clocktower?.titleCn).toBe('血染钟楼');
  });

  it('requires user-facing Chinese titles for every shipped game', () => {
    const untranslatedGames = GAME_DATABASE.filter(
      (game) => !CJK_TITLE_PATTERN.test(game.titleCn),
    ).map((game) => ({
      id: game.id,
      titleCn: game.titleCn,
      titleEn: game.titleEn,
    }));

    expect(untranslatedGames).toEqual([]);
  });

  it('ensures every full-tier game has structured referee knowledge', () => {
    const incompleteGames = GAME_DATABASE.filter((game) => {
      const knowledgeTier = game.knowledgeTier ?? (game.knowledgeBase?.trim() ? 'full' : 'catalog');
      return (
        knowledgeTier === 'full' &&
        (
          !game.rules?.target?.trim() ||
          !game.rules?.flow?.trim() ||
          !game.rules?.tips?.trim() ||
          !game.FAQ?.trim() ||
          !(game.commonQuestions ?? []).length ||
          !game.knowledgeBase?.trim()
        )
      );
    }).map((game) => ({
      id: game.id,
      titleCn: game.titleCn,
      hasTarget: Boolean(game.rules?.target?.trim()),
      hasFlow: Boolean(game.rules?.flow?.trim()),
      hasTips: Boolean(game.rules?.tips?.trim()),
      hasFaq: Boolean(game.FAQ?.trim()),
      commonQuestionCount: (game.commonQuestions ?? []).length,
      hasKnowledgeBase: Boolean(game.knowledgeBase?.trim()),
    }));

    expect(incompleteGames).toEqual([]);
  });
});

describe('gameDatabase auto expansion completeness', () => {
  it('ensures every auto expansion game is referee-ready before shipping', () => {
    const incompleteGames = GAME_DATABASE_AUTO_EXPANSION.filter((game) => (
      (game.knowledgeTier ?? 'catalog') !== 'full' ||
      !game.rules?.target?.trim() ||
      !game.rules?.flow?.trim() ||
      !game.rules?.tips?.trim() ||
      !game.FAQ?.trim() ||
      !(game.commonQuestions ?? []).length ||
      !game.knowledgeBase?.trim() ||
      !game.coverUrl?.trim() ||
      !game.coverUrl.startsWith('/game-covers/') ||
      !game.bilibiliId?.trim()
    )).map((game) => ({
      id: game.id,
      knowledgeTier: game.knowledgeTier,
      hasTarget: Boolean(game.rules?.target?.trim()),
      hasFlow: Boolean(game.rules?.flow?.trim()),
      hasTips: Boolean(game.rules?.tips?.trim()),
      hasFaq: Boolean(game.FAQ?.trim()),
      commonQuestionCount: (game.commonQuestions ?? []).length,
      hasKnowledgeBase: Boolean(game.knowledgeBase?.trim()),
      coverUrl: game.coverUrl,
      bilibiliId: game.bilibiliId,
    }));

    expect(incompleteGames).toEqual([]);
  });
});

describe('gameDatabase catalog expansion completeness', () => {
  it('ensures every catalog expansion game is recommendation-ready before shipping', () => {
    const incompleteGames = GAME_DATABASE_CATALOG_EXPANSION.filter((game) => (
      (game.knowledgeTier ?? 'catalog') !== 'catalog' ||
      !game.titleCn?.trim() ||
      !game.titleEn?.trim() ||
      !game.oneLiner?.trim() ||
      !(game.tags ?? []).length ||
      !game.coverUrl?.trim() ||
      !game.coverUrl.startsWith('/game-covers/') ||
      !game.bilibiliId?.trim() ||
      !game.tutorialVideoUrl?.trim()
    )).map((game) => ({
      id: game.id,
      knowledgeTier: game.knowledgeTier,
      hasTitleCn: Boolean(game.titleCn?.trim()),
      hasTitleEn: Boolean(game.titleEn?.trim()),
      hasOneLiner: Boolean(game.oneLiner?.trim()),
      tagCount: (game.tags ?? []).length,
      coverUrl: game.coverUrl,
      bilibiliId: game.bilibiliId,
      tutorialVideoUrl: game.tutorialVideoUrl,
    }));

    expect(incompleteGames).toEqual([]);
  });
});
