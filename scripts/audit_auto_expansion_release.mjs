import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_ROOT,
  compactText,
  loadAutoExpansionDatabase,
  loadGameDatabase,
  readJsonLines,
} from './lib/game_data_loader.mjs';

const DEFAULT_REPORT_PATH = 'rag_evals/reports/auto_expansion_release/audit_latest.json';
const REQUIRED_REFEREE_SECTION_IDS = new Set([
  'summary',
  'rules_target',
  'rules_flow',
  'rules_tips',
  'faq',
  'knowledge_base',
]);
const REQUIRED_RECOMMENDATION_SECTION_IDS = new Set([
  'rec_summary',
  'rec_fit',
  'rec_tags',
  'rec_search',
]);

function parseArgs(argv) {
  const args = {
    reportJson: DEFAULT_REPORT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--report-json') {
      args.reportJson = argv[index + 1] ?? DEFAULT_REPORT_PATH;
      index += 1;
    }
  }

  return args;
}

function pushFailure(failures, gameId, message, details = {}) {
  failures.push({
    gameId,
    message,
    ...details,
  });
}

function pushWarning(warnings, gameId, message, details = {}) {
  warnings.push({
    gameId,
    message,
    ...details,
  });
}

function hasText(value) {
  return compactText(value).length > 0;
}

function getMissingSectionIds(actualIds, requiredIds) {
  return [...requiredIds].filter((sectionId) => !actualIds.has(sectionId));
}

async function fileExists(relativePath) {
  try {
    await fs.access(path.join(PROJECT_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [autoExpansionGames, mergedGames, combinedDocuments, recommendationDocuments, sectionDocuments] =
    await Promise.all([
      loadAutoExpansionDatabase(),
      loadGameDatabase(),
      readJsonLines('knowledge/boardgame_kb.jsonl'),
      readJsonLines('knowledge/boardgame_recommendation_kb.jsonl'),
      readJsonLines('knowledge/boardgame_kb_sections.jsonl'),
    ]);

  const failures = [];
  const warnings = [];
  const mergedById = new Map(mergedGames.map((game) => [game.id, game]));
  const combinedDocIds = new Set(combinedDocuments.map((document) => document.document_id));
  const recommendationDocIds = new Set(recommendationDocuments.map((document) => document.document_id));
  const sectionDocsByGameId = new Map();

  for (const document of sectionDocuments) {
    const gameId = compactText(document.game_id);
    if (!gameId) {
      continue;
    }

    const bucket = sectionDocsByGameId.get(gameId) ?? [];
    bucket.push(document);
    sectionDocsByGameId.set(gameId, bucket);
  }

  for (const autoGame of autoExpansionGames) {
    const mergedGame = mergedById.get(autoGame.id);
    if (!mergedGame) {
      pushFailure(failures, autoGame.id, 'Merged GAME_DATABASE is missing this auto-expansion game.');
      continue;
    }

    if ((mergedGame.knowledgeTier ?? 'catalog') !== 'full') {
      pushFailure(failures, autoGame.id, 'knowledgeTier is not full in merged GAME_DATABASE.');
    }

    if (!hasText(mergedGame.titleCn) || !hasText(mergedGame.titleEn)) {
      pushFailure(failures, autoGame.id, 'titleCn/titleEn must both be present.');
    }

    if (!hasText(mergedGame.oneLiner)) {
      pushFailure(failures, autoGame.id, 'oneLiner is missing.');
    }

    if (!hasText(mergedGame.rules?.target) || !hasText(mergedGame.rules?.flow) || !hasText(mergedGame.rules?.tips)) {
      pushFailure(failures, autoGame.id, 'rules.target / rules.flow / rules.tips must all be present.');
    }

    if (!hasText(mergedGame.FAQ)) {
      pushFailure(failures, autoGame.id, 'FAQ is missing.');
    }

    if (!hasText(mergedGame.knowledgeBase)) {
      pushFailure(failures, autoGame.id, 'knowledgeBase is missing.');
    }

    if (!Array.isArray(mergedGame.commonQuestions) || mergedGame.commonQuestions.length < 3) {
      pushFailure(failures, autoGame.id, 'commonQuestions must contain at least 3 items.', {
        actualCount: Array.isArray(mergedGame.commonQuestions) ? mergedGame.commonQuestions.length : 0,
      });
    }

    if (!mergedGame.coverUrl?.startsWith('/game-covers/')) {
      pushFailure(failures, autoGame.id, 'coverUrl must point to a localized asset under /game-covers/.', {
        coverUrl: mergedGame.coverUrl,
      });
    } else {
      const coverRelativePath = path.join('public', mergedGame.coverUrl.slice(1));
      if (!(await fileExists(coverRelativePath))) {
        pushFailure(failures, autoGame.id, 'Localized cover asset is missing from public/.', {
          coverUrl: mergedGame.coverUrl,
          expectedPath: coverRelativePath,
        });
      }
    }

    if (!hasText(mergedGame.bilibiliId) || !hasText(mergedGame.tutorialVideoUrl)) {
      pushFailure(failures, autoGame.id, 'bilibiliId and tutorialVideoUrl must both be present.', {
        bilibiliId: mergedGame.bilibiliId ?? '',
        tutorialVideoUrl: mergedGame.tutorialVideoUrl ?? '',
      });
    }

    if (!Array.isArray(mergedGame.bestPlayerCount) || mergedGame.bestPlayerCount.length === 0) {
      pushFailure(failures, autoGame.id, 'bestPlayerCount is missing.');
    }

    if (!mergedGame.recommendationProfile?.allTags?.length || !mergedGame.recommendationProfile?.searchTerms?.length) {
      pushFailure(
        failures,
        autoGame.id,
        'recommendationProfile must exist with allTags and searchTerms after merge normalization.',
      );
    }

    if (!hasText(mergedGame.bggId) || !hasText(mergedGame.bggUrl)) {
      pushWarning(warnings, autoGame.id, 'BGG metadata is incomplete.', {
        bggId: mergedGame.bggId ?? '',
        bggUrl: mergedGame.bggUrl ?? '',
      });
    }

    if (!combinedDocIds.has(mergedGame.id)) {
      pushFailure(failures, autoGame.id, 'Referee knowledge document is missing from knowledge/boardgame_kb.jsonl.');
    }

    const recommendationDocumentId = `recommendation:${mergedGame.id}`;
    if (!combinedDocIds.has(recommendationDocumentId)) {
      pushFailure(
        failures,
        autoGame.id,
        'Recommendation document is missing from knowledge/boardgame_kb.jsonl.',
      );
    }

    if (!recommendationDocIds.has(recommendationDocumentId)) {
      pushFailure(
        failures,
        autoGame.id,
        'Recommendation document is missing from knowledge/boardgame_recommendation_kb.jsonl.',
      );
    }

    const sectionBucket = sectionDocsByGameId.get(mergedGame.id) ?? [];
    const refereeSectionIds = new Set(
      sectionBucket
        .filter((document) => !String(document.document_id ?? '').startsWith('recommendation:'))
        .map((document) => document.section_id),
    );
    const recommendationSectionIds = new Set(
      sectionBucket
        .filter((document) => String(document.document_id ?? '').startsWith('recommendation:'))
        .map((document) => document.section_id),
    );

    const missingRefereeSectionIds = getMissingSectionIds(refereeSectionIds, REQUIRED_REFEREE_SECTION_IDS);
    if (missingRefereeSectionIds.length > 0) {
      pushFailure(failures, autoGame.id, 'Referee section export is incomplete.', {
        missingSectionIds: missingRefereeSectionIds,
      });
    }

    const missingRecommendationSectionIds = getMissingSectionIds(
      recommendationSectionIds,
      REQUIRED_RECOMMENDATION_SECTION_IDS,
    );
    if (missingRecommendationSectionIds.length > 0) {
      pushFailure(failures, autoGame.id, 'Recommendation section export is incomplete.', {
        missingSectionIds: missingRecommendationSectionIds,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    autoExpansionGameCount: autoExpansionGames.length,
    mergedGameCount: mergedGames.length,
    exportedDocumentCounts: {
      combined: combinedDocuments.length,
      recommendation: recommendationDocuments.length,
      sections: sectionDocuments.length,
    },
    failures,
    warnings,
    failureCount: failures.length,
    warningCount: warnings.length,
    pass: failures.length === 0,
  };

  const reportPath = path.join(PROJECT_ROOT, args.reportJson);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        pass: report.pass,
        autoExpansionGameCount: report.autoExpansionGameCount,
        failureCount: report.failureCount,
        warningCount: report.warningCount,
        reportJson: args.reportJson,
      },
      null,
      2,
    ),
  );

  if (!report.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

