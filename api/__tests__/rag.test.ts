import { describe, expect, it } from 'vitest';
import ragHandler from '../rag';

describe('/api/rag agent-friendly contract', () => {
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
    expect(topGames.some((gameId: string) => ['luckynumbers', 'kingdomino', 'carcassonne', 'splendor', 'azul'].includes(gameId))).toBe(true);
  });
});
