import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const SECTION_FILE = path.join(PROJECT_ROOT, 'knowledge/boardgame_kb_sections.jsonl');
const DOCUMENT_FILE = path.join(PROJECT_ROOT, 'knowledge/boardgame_kb.jsonl');
const RECOMMENDATION_FILE = path.join(PROJECT_ROOT, 'knowledge/boardgame_recommendation_kb.jsonl');

const CJK_PATTERN = /[\u3400-\u9fff]/;
const MOJIBAKE_PATTERN = /�|Ã|Â|â€|ðŸ|å[^\s]|ä[^\s]/;
const RECOMMENDATION_PUNCTUATION_NOISE = /、、、|：、|、。|：\s*。|用户可能会这样描述它：\s*。/;
const REQUIRED_SECTION_IDS = new Set([
  'summary',
  'rules_target',
  'rules_flow',
  'rules_tips',
  'faq',
  'knowledge_base',
  'rec_summary',
  'rec_fit',
  'rec_tags',
  'rec_search',
]);

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return jsonParse(line);
      } catch (error) {
        throw new Error(`${path.relative(PROJECT_ROOT, filePath)}:${index + 1} invalid JSON: ${error.message}`);
      }
    });
}

function jsonParse(line) {
  return JSON.parse(line);
}

function failIf(condition, message, failures) {
  if (condition) {
    failures.push(message);
  }
}

function getGameId(row) {
  return String(row.game_id || row.metadata?.game_id || row.document_id || '').trim();
}

function getTitleCn(row) {
  return String(row.title_cn || row.metadata?.title_cn || row.title || '').trim();
}

const failures = [];

for (const filePath of [SECTION_FILE, DOCUMENT_FILE, RECOMMENDATION_FILE]) {
  failIf(!fs.existsSync(filePath), `missing ${path.relative(PROJECT_ROOT, filePath)}`, failures);
}

if (failures.length === 0) {
  const sectionRows = readJsonl(SECTION_FILE);
  const gameRows = new Map();
  const sectionsByGame = new Map();

  for (const row of sectionRows) {
    const gameId = getGameId(row);
    const titleCn = getTitleCn(row);
    const content = String(row.content || row.text || row.search_text || '');
    const sectionId = String(row.section_id || row.metadata?.section_id || '').trim();

    if (gameId && !gameRows.has(gameId)) {
      gameRows.set(gameId, row);
    }

    if (gameId && sectionId) {
      if (!sectionsByGame.has(gameId)) {
        sectionsByGame.set(gameId, new Set());
      }
      sectionsByGame.get(gameId).add(sectionId);
    }

    failIf(!gameId, `section row missing game_id: ${JSON.stringify(row).slice(0, 120)}`, failures);
    failIf(titleCn && !CJK_PATTERN.test(titleCn), `${gameId} title_cn is not localized: ${titleCn}`, failures);
    failIf(MOJIBAKE_PATTERN.test(content) || MOJIBAKE_PATTERN.test(titleCn), `${gameId}:${sectionId} contains mojibake`, failures);
    failIf(RECOMMENDATION_PUNCTUATION_NOISE.test(content), `${gameId}:${sectionId} contains recommendation punctuation noise`, failures);
  }

  failIf(gameRows.size !== 500, `expected 500 games in section export, got ${gameRows.size}`, failures);

  for (const [gameId, sectionIds] of sectionsByGame.entries()) {
    const missingSections = [...REQUIRED_SECTION_IDS].filter((sectionId) => !sectionIds.has(sectionId));
    failIf(missingSections.length > 0, `${gameId} missing exported sections: ${missingSections.join(', ')}`, failures);
  }

  const documents = readJsonl(DOCUMENT_FILE);
  const recommendationDocuments = readJsonl(RECOMMENDATION_FILE);
  failIf(documents.length !== 1000, `expected 1000 combined KB docs, got ${documents.length}`, failures);
  failIf(recommendationDocuments.length !== 500, `expected 500 recommendation docs, got ${recommendationDocuments.length}`, failures);
}

if (failures.length > 0) {
  console.error('KB validation failed:');
  for (const failure of failures.slice(0, 80)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 80) {
    console.error(`- ... ${failures.length - 80} more failures`);
  }
  process.exit(1);
}

console.log('KB validation passed: 500 games, 1000 docs, 500 recommendations, 5000 clean sections.');
