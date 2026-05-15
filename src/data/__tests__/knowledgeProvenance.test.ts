import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SECTION_FILE = path.join(PROJECT_ROOT, 'knowledge/boardgame_kb_sections.jsonl');

function readJsonl(filePath: string) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('boardgame knowledge provenance metadata', () => {
  it('requires every exported knowledge section to carry confidence and source refs', () => {
    const rows = readJsonl(SECTION_FILE);
    const invalidRows = rows.filter((row) => (
      typeof row.confidence_score !== 'number' ||
      row.confidence_score < 0 ||
      row.confidence_score > 1 ||
      !['source_backed', 'reviewed', 'needs_review', 'stale'].includes(row.verification_status) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.verified_at) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.stale_at) ||
      !Array.isArray(row.source_refs) ||
      row.source_refs.length < 1 ||
      !row.primary_source_type
    )).map((row) => ({
      document_id: row.document_id,
      confidence_score: row.confidence_score,
      verification_status: row.verification_status,
      primary_source_type: row.primary_source_type,
    }));

    expect(invalidRows).toEqual([]);
  });

  it('keeps low-certainty local-only knowledge visible for review instead of pretending it is source-backed', () => {
    const rows = readJsonl(SECTION_FILE);
    const needsReviewRows = rows.filter((row) => row.verification_status === 'needs_review');
    const sourceBackedRows = rows.filter((row) => row.verification_status === 'source_backed');

    expect(needsReviewRows.length).toBeGreaterThan(0);
    expect(sourceBackedRows.length).toBeGreaterThan(0);
    expect(sourceBackedRows.every((row) => row.source_types_text.includes('bga_public_gamepanel'))).toBe(true);
  });
});
