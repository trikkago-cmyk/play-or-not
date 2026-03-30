export interface RagHit {
  chunk_id: string;
  document_id: string;
  title: string;
  text: string;
  source?: string | null;
  distance: number;
  score: number;
  section_id?: string | null;
  section_title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RagCitation {
  label: string;
  chunkId: string;
  gameId?: string;
  title: string;
  sectionTitle?: string;
  snippet: string;
}

export interface RagEvidencePack {
  contextText: string;
  citations: RagCitation[];
}

interface QueryKnowledgeBaseOptions {
  topK?: number;
  where?: Record<string, unknown>;
  whereDocument?: Record<string, unknown>;
}

interface RagQueryResponse {
  query: string;
  top_k: number;
  hits: RagHit[];
}

export async function queryKnowledgeBase(
  query: string,
  options: QueryKnowledgeBaseOptions = {},
): Promise<RagHit[]> {
  const response = await fetch('/api/rag', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      top_k: options.topK ?? 4,
      where: options.where,
      where_document: options.whereDocument,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || payload.detail || 'RAG query failed');
  }

  return Array.isArray((payload as RagQueryResponse).hits)
    ? (payload as RagQueryResponse).hits
    : [];
}

function summarizeCitationSnippet(text: string, maxLength: number = 88): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

export function buildRagEvidencePack(hits: RagHit[]): RagEvidencePack {
  const citations = hits.map((hit, index) => ({
    label: `证据${index + 1}`,
    chunkId: hit.chunk_id,
    gameId: typeof hit.metadata?.game_id === 'string' ? hit.metadata.game_id : undefined,
    title: hit.title,
    sectionTitle: hit.section_title ?? undefined,
    snippet: summarizeCitationSnippet(hit.text),
  }));

  const contextText = hits
    .map((hit, index) => {
      const heading = hit.section_title
        ? `${hit.title} / ${hit.section_title}`
        : hit.title;

      return [
        `[证据${index + 1}] ${heading}`,
        hit.text.trim(),
      ].join('\n');
    })
    .join('\n\n');

  return {
    contextText,
    citations,
  };
}

export function formatRagContext(hits: RagHit[]): string {
  return buildRagEvidencePack(hits).contextText;
}
