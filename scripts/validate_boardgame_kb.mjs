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
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_VERIFICATION_STATUSES = new Set(['source_backed', 'reviewed', 'needs_review', 'stale']);
const ALLOWED_CANONICALITY = new Set([
  'platform_rules_excerpt',
  'structured_platform_metadata',
  'community_metadata',
  'local_curated_summary',
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

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseSourceRefs(row) {
  if (Array.isArray(row.source_refs)) {
    return row.source_refs;
  }

  const raw = row.source_refs_json || row.metadata?.source_refs_json;
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateProvenance(row, label, failures) {
  const metadata = row.metadata || {};
  const confidenceScore = row.confidence_score ?? metadata.confidence_score;
  const wikiProvenanceVersion = row.wiki_provenance_version ?? metadata.wiki_provenance_version;
  const confidenceMethod = row.confidence_method ?? metadata.confidence_method;
  const confidenceBasisText = row.confidence_basis_text ?? metadata.confidence_basis_text;
  const verificationStatus = row.verification_status ?? metadata.verification_status;
  const reviewQueueReason = row.review_queue_reason ?? metadata.review_queue_reason;
  const verifiedAt = row.verified_at ?? metadata.verified_at;
  const sourceRetrievedAt = row.source_retrieved_at ?? metadata.source_retrieved_at;
  const staleAfterDays = row.stale_after_days ?? metadata.stale_after_days;
  const staleAt = row.stale_at ?? metadata.stale_at;
  const canonicality = row.canonicality ?? metadata.canonicality;
  const primarySourceType = row.primary_source_type ?? metadata.primary_source_type;
  const sourceRefCount = row.source_ref_count ?? metadata.source_ref_count;
  const sourceTypesText = row.source_types_text ?? metadata.source_types_text;
  const sourceRefs = parseSourceRefs(row);

  failIf(
    typeof confidenceScore !== 'number' || confidenceScore < 0 || confidenceScore > 1,
    `${label} invalid confidence_score: ${confidenceScore}`,
    failures,
  );
  failIf(!hasValue(wikiProvenanceVersion), `${label} missing wiki_provenance_version`, failures);
  failIf(!hasValue(confidenceMethod), `${label} missing confidence_method`, failures);
  failIf(!hasValue(confidenceBasisText), `${label} missing confidence_basis_text`, failures);
  failIf(!ALLOWED_VERIFICATION_STATUSES.has(String(verificationStatus)), `${label} invalid verification_status: ${verificationStatus}`, failures);
  failIf(String(verificationStatus) !== 'source_backed' && !hasValue(reviewQueueReason), `${label} missing review_queue_reason`, failures);
  failIf(!ISO_DATE_PATTERN.test(String(verifiedAt)), `${label} invalid verified_at: ${verifiedAt}`, failures);
  failIf(!ISO_DATE_PATTERN.test(String(sourceRetrievedAt)), `${label} invalid source_retrieved_at: ${sourceRetrievedAt}`, failures);
  failIf(typeof staleAfterDays !== 'number' || staleAfterDays <= 0, `${label} invalid stale_after_days: ${staleAfterDays}`, failures);
  failIf(!ISO_DATE_PATTERN.test(String(staleAt)), `${label} invalid stale_at: ${staleAt}`, failures);
  failIf(!ALLOWED_CANONICALITY.has(String(canonicality)), `${label} invalid canonicality: ${canonicality}`, failures);
  failIf(!hasValue(primarySourceType), `${label} missing primary_source_type`, failures);
  failIf(typeof sourceRefCount !== 'number' || sourceRefCount < 1, `${label} invalid source_ref_count: ${sourceRefCount}`, failures);
  failIf(!hasValue(sourceTypesText), `${label} missing source_types_text`, failures);
  failIf(sourceRefs.length < 1, `${label} missing source_refs`, failures);
  failIf(sourceRefs.length > 0 && sourceRefs.length !== sourceRefCount, `${label} source_ref_count mismatch`, failures);
  failIf(
    String(verificationStatus) === 'source_backed' && !String(sourceTypesText).includes('bga_public_gamepanel'),
    `${label} source_backed row lacks bga_public_gamepanel evidence`,
    failures,
  );

  sourceRefs.forEach((sourceRef, index) => {
    const sourceLabel = `${label} source_refs[${index}]`;
    failIf(!hasValue(sourceRef?.source_type), `${sourceLabel} missing source_type`, failures);
    failIf(!hasValue(sourceRef?.title), `${sourceLabel} missing title`, failures);
    failIf(!hasValue(sourceRef?.url), `${sourceLabel} missing url`, failures);
    failIf(!ISO_DATE_PATTERN.test(String(sourceRef?.retrieved_at || '')), `${sourceLabel} invalid retrieved_at`, failures);
    failIf(typeof sourceRef?.confidence !== 'number' || sourceRef.confidence < 0 || sourceRef.confidence > 1, `${sourceLabel} invalid confidence`, failures);
    failIf(!hasValue(sourceRef?.evidence_scope), `${sourceLabel} missing evidence_scope`, failures);
  });
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
    validateProvenance(row, `${gameId}:${sectionId}`, failures);
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

  for (const document of [...documents, ...recommendationDocuments]) {
    validateProvenance({ metadata: document.metadata }, `${document.document_id}:document`, failures);
    for (const section of document.sections || []) {
      validateProvenance({ metadata: section.metadata }, `${document.document_id}:${section.section_id}`, failures);
    }
  }
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

console.log('KB validation passed: 500 games, 1000 docs, 500 recommendations, 5000 clean sections with provenance metadata.');
