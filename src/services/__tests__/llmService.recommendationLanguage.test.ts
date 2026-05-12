import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_DATABASE } from '@/data/gameDatabase';
import { getLLMResponse, initLLMConfig } from '../llmService';

describe('llmService recommendation language guardrail', () => {
  beforeEach(() => {
    initLLMConfig();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'avalon:recommendation:1',
                document_id: 'avalon',
                title: '阿瓦隆',
                text: '适合 5 到 10 人的阵营推理聚会局。',
                section_title: '推荐词条',
                distance: 0.08,
                score: 0.92,
                metadata: { game_id: 'avalon' },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  reply: '我直接给你推荐召回中最稳的这一句：**《阿瓦隆》**。',
                  recommendation_name: '阿瓦隆',
                  recommendation_id: 'avalon',
                }),
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('removes internal retrieval jargon from user-facing recommendation copy', async () => {
    const result = await getLLMResponse(
      '推荐一个 6 人聚会桌游',
      'recommendation',
      undefined,
      [],
      [],
    );

    expect(result.text).toContain('**《阿瓦隆》**');
    expect(result.text).not.toContain('召回');
    expect(result.text).not.toContain('候选池');
    expect(result.text).not.toContain('recommendation_id');
  });

  it('rewrites harsher retrieval phrasing into natural DM copy', async () => {
    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'avalon:recommendation:1',
                document_id: 'avalon',
                title: '阿瓦隆',
                text: '适合 5 到 10 人的阵营推理聚会局。',
                section_title: '推荐词条',
                distance: 0.08,
                score: 0.92,
                metadata: { game_id: 'avalon' },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  reply: '按你刚才这句，我先回到当前召回里最稳的一款：**《阿瓦隆》**。',
                  recommendation_name: '阿瓦隆',
                  recommendation_id: 'avalon',
                }),
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      '推荐一个 6 人聚会桌游',
      'recommendation',
      undefined,
      [],
      [],
    );

    expect(result.text).toContain('**《阿瓦隆》**');
    expect(result.text).not.toContain('召回');
    expect(result.text).not.toContain('最稳');
  });

  it('prefers a localized fallback when the model tries to surface an untranslated title by default', async () => {
    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({ hits: [] }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  reply: '我先推荐 **《Wispwood》**。',
                  recommendation_name: 'Wispwood',
                  recommendation_id: 'wispwood',
                }),
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      '推荐一个适合 3-4 人、家庭同乐、拼图布局、15 分钟左右的桌游',
      'recommendation',
      undefined,
      [],
      [],
    );

    expect(result.gameId).not.toBe('wispwood');
    expect(result.text).not.toContain('Wispwood');

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(/[一-龥]/.test(recommendedGame?.titleCn ?? '')).toBe(true);
  });
});
