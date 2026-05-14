import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import handler from '../user-data';
import { createSession, createSessionCookie } from '../_lib/auth';
import { resetLocalUserDataStoreForTests } from '../_lib/userDataStore';

async function createAuthenticatedRequest(url: string, init: RequestInit = {}) {
  const session = await createSession('luosi@example.com');
  const cookie = createSessionCookie(new Request(url), session.token);

  return new Request(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      cookie,
    },
  });
}

describe('/api/user-data', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-auth-secret';
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    resetLocalUserDataStoreForTests();
  });

  afterEach(() => {
    resetLocalUserDataStoreForTests();
  });

  it('requires an authenticated session', async () => {
    const response = await handler(new Request('http://localhost/api/user-data'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('persists sessions and memory for the logged-in account', async () => {
    const putResponse = await handler(await createAuthenticatedRequest('http://localhost/api/user-data', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessions: [
          {
            id: 'session-a',
            title: '六个人聚会',
            messages: [],
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        currentSessionId: 'session-a',
        memory: {
          likedTags: { 朋友聚会: 2 },
          dislikedTags: {},
          likedGames: [],
          dislikedGames: [],
          preferredPlayerCounts: { '6人': 1 },
          preferredDurations: {},
          preferredComplexities: {},
          evidence: [],
        },
      }),
    }));

    expect(putResponse.status).toBe(200);

    const getResponse = await handler(await createAuthenticatedRequest('http://localhost/api/user-data'));

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      ok: true,
      data: {
        sessions: [
          expect.objectContaining({
            id: 'session-a',
            title: '六个人聚会',
          }),
        ],
        currentSessionId: 'session-a',
        memory: expect.objectContaining({
          likedTags: { 朋友聚会: 2 },
        }),
      },
      storage: expect.objectContaining({
        durable: false,
        provider: 'local_memory',
      }),
    });
  });

  it('fails loudly on Vercel when Upstash Redis is not configured', async () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';

    const response = await handler(await createAuthenticatedRequest('https://preview.example.com/api/user-data'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'user_data_store_unconfigured',
      storage: expect.objectContaining({
        requiredEnv: [
          'UPSTASH_REDIS_REST_URL or KV_REST_API_URL',
          'UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN',
          'or BLOB_READ_WRITE_TOKEN',
        ],
      }),
    });
  });
});
