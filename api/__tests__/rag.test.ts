import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ragHandler from '../rag';

describe('/api/rag agent-friendly contract', () => {
  const originalRagServiceUrl = process.env.RAG_SERVICE_URL;
  const originalRagRequireService = process.env.RAG_REQUIRE_SERVICE;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.RAG_SERVICE_URL;
    delete process.env.RAG_REQUIRE_SERVICE;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    if (originalRagServiceUrl === undefined) {
      delete process.env.RAG_SERVICE_URL;
    } else {
      process.env.RAG_SERVICE_URL = originalRagServiceUrl;
    }

    if (originalRagRequireService === undefined) {
      delete process.env.RAG_REQUIRE_SERVICE;
    } else {
      process.env.RAG_REQUIRE_SERVICE = originalRagRequireService;
    }

    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns documentation when describe=1', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag?describe=1', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.endpoint).toBe('/api/rag');
    expect(payload.allowed_methods).toContain('POST');
  });

  it('supports the Node-style Vercel request shape for describe=1', async () => {
    const response = await ragHandler({
      method: 'GET',
      url: '/api/rag?describe=1',
      headers: {
        host: 'localhost',
        'x-forwarded-proto': 'https',
      },
    } as any);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(200);

    const payload = await (response as Response).json();
    expect(payload.endpoint).toBe('/api/rag');
    expect(payload.allowed_methods).toContain('GET');
  });

  it('returns local fallback health when no RAG sidecar is configured', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.status).toBe('ok');
    expect(payload.provider).toBe('local_sections_lexical');
    expect(payload.section_documents).toBeGreaterThan(0);
    expect(response.headers.get('x-rag-provider')).toBe('local_sections_lexical');
    expect(response.headers.get('x-rag-fallback')).toBe('true');
  });

  it('proxies to the configured Python RAG service when RAG_SERVICE_URL is set', async () => {
    process.env.RAG_SERVICE_URL = 'http://rag-service.test';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://rag-service.test/query');
      return new Response(JSON.stringify({
        query: '推荐一个9人聚会游戏',
        top_k: 1,
        hits: [],
        strategy: 'hybrid_rrf_rerank_aggregated',
        diagnostics: { hybrid_enabled: true },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });
    globalThis.fetch = fetchMock as any;

    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '推荐一个9人聚会游戏',
        top_k: 1,
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-rag-provider')).toBe('python_rag');
    expect(response.headers.get('x-rag-fallback')).toBe('false');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const payload = await response.json();
    expect(payload.strategy).toBe('hybrid_rrf_rerank_aggregated');
  });

  it('fails closed instead of silently falling back when RAG_REQUIRE_SERVICE is enabled', async () => {
    process.env.RAG_SERVICE_URL = 'http://rag-service.test';
    process.env.RAG_REQUIRE_SERVICE = 'true';
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as any;

    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '推荐一个9人聚会游戏',
        top_k: 1,
      }),
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get('x-rag-provider')).toBe('unavailable');
    expect(response.headers.get('x-rag-required')).toBe('true');

    const payload = await response.json();
    expect(payload.code).toBe('rag_service_unavailable');
    expect(payload.detail).toContain('connection refused');
  });

  it('preserves the original query body when non-strict remote RAG falls back locally', async () => {
    process.env.RAG_SERVICE_URL = 'http://rag-service.test';
    globalThis.fetch = vi.fn(async () => {
      throw new Error('connection refused');
    }) as any;

    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '亲子时光 推荐游戏',
        top_k: 3,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-rag-provider')).toBe('local_sections_lexical');
    expect(response.headers.get('x-rag-fallback')).toBe('true');

    const payload = await response.json();
    expect(payload.query).toBe('亲子时光 推荐游戏');
    expect(payload.strategy).toBe('local_sections_lexical');
    expect(payload.hits.length).toBeGreaterThan(0);
  });

  it('returns local fallback hits for a parent-child recommendation query', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '亲子时光 推荐游戏',
        top_k: 5,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.strategy).toBe('local_sections_lexical');
    expect(Array.isArray(payload.hits)).toBe(true);
    expect(payload.hits.length).toBeGreaterThan(0);
    expect(payload.hits.some((hit: any) => ['carcassonne', 'kingdomino', 'splendor', 'ticket-to-ride', 'uno'].includes(hit.metadata?.game_id))).toBe(true);
    expect(payload.hits[0]?.metadata?.game_id).not.toBe('avalon');
  });

  it('prefers family-friendly classics over social deduction for parent queries', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '带爸妈一起玩，规则简单，30分钟内',
        top_k: 5,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    const payload = await response.json();
    const topGames = payload.hits.map((hit: any) => hit.metadata?.game_id);
    expect(topGames[0]).not.toBe('avalon');
    expect(topGames.some((gameId: string) => ['kingdomino', 'splendor', 'carcassonne', 'ticket-to-ride', 'cascadia'].includes(gameId))).toBe(true);
    expect(topGames.some((gameId: string) => ['dobble', 'halli-galli'].includes(gameId))).toBe(false);
  });

  it('prefers classic light strategy titles for 2-to-4 player queries', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '推荐一个经典耐玩的2到4人桌游',
        top_k: 5,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    const payload = await response.json();
    const topGames = payload.hits.map((hit: any) => hit.metadata?.game_id);
    expect(topGames[0]).toBeDefined();
    expect(topGames[0]).not.toBe('dobble');
    expect(topGames[0]).not.toBe('avalon');
    expect(topGames.some((gameId: string) => ['carcassonne', 'splendor', 'azul', 'ticket-to-ride', 'kingdomino'].includes(gameId))).toBe(true);
  });

  it('respects gentle mid-strategy queries without drifting to heavy social deduction', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '3到4个人，想玩有策略但别太重',
        top_k: 5,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    const payload = await response.json();
    const topGames = payload.hits.map((hit: any) => hit.metadata?.game_id);
    expect(topGames[0]).toBeDefined();
    expect(topGames[0]).not.toBe('avalon');
    expect(topGames.some((gameId: string) => [
      'luckynumbers',
      'kingdomino',
      'carcassonne',
      'splendor',
      'azul',
      'copenhagen',
      'cacao',
      'isleofcats',
      'azulsummerpavilion',
    ].includes(gameId))).toBe(true);
  });

  it('applies atomic recommendation metadata filters in the local fallback', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '九人局家庭聚会，来个轻松点的',
        top_k: 5,
        where: {
          $and: [
            { mode: 'recommendation' },
            { min_players: { $lte: 9 } },
            { max_players: { $gte: 9 } },
            { playtime_min: { $lte: 30 } },
            { complexity: { $lte: 2.4 } },
            { age_rating: { $lte: 8 } },
          ],
        },
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.strategy).toBe('local_sections_lexical');
    expect(payload.hits.length).toBeGreaterThan(0);
    for (const hit of payload.hits) {
      expect(hit.metadata?.min_players).toBeLessThanOrEqual(9);
      expect(hit.metadata?.max_players).toBeGreaterThanOrEqual(9);
      expect(hit.metadata?.playtime_min).toBeLessThanOrEqual(30);
      expect(hit.metadata?.complexity).toBeLessThanOrEqual(2.4);
      expect(hit.metadata?.age_rating).toBeLessThanOrEqual(8);
    }
  });

  it('derives missing recommendation metadata filters from the query before local fallback retrieval', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '九人局家庭聚会，30分钟内，规则简单，8岁孩子也能玩',
        top_k: 5,
        where: {
          mode: 'recommendation',
        },
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.strategy).toBe('local_sections_lexical');
    expect(payload.hits.length).toBeGreaterThan(0);
    for (const hit of payload.hits) {
      expect(hit.metadata?.mode).toBe('recommendation');
      expect(hit.metadata?.min_players).toBeLessThanOrEqual(9);
      expect(hit.metadata?.max_players).toBeGreaterThanOrEqual(9);
      expect(hit.metadata?.playtime_min).toBeLessThanOrEqual(30);
      expect(hit.metadata?.complexity).toBeLessThanOrEqual(2.4);
      expect(hit.metadata?.age_rating).toBeLessThanOrEqual(8);
    }
  });
});
