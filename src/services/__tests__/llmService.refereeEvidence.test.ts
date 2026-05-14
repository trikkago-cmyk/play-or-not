import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_DATABASE } from '@/data/gameDatabase';
import { getLLMResponse, initLLMConfig } from '../llmService';

describe('llmService referee evidence guardrail', () => {
  const activeGame = GAME_DATABASE.find((game) => game.id === 'uno');
  const halliGalli = GAME_DATABASE.find((game) => game.id === 'halli-galli');

  beforeEach(() => {
    initLLMConfig();
    localStorage.clear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'uno:faq:1',
                document_id: 'uno',
                title: 'UNO (优诺)',
                text: '- **Q: +4 可以随便出吗？**\n  - A: **不可以！** 只有没有同色牌时才能出。',
                section_title: '常见问题',
                distance: 0.12,
                score: 0.88,
                metadata: { game_id: 'uno' },
              },
              {
                chunk_id: 'uno:knowledge_base:1',
                document_id: 'uno',
                title: 'UNO (优诺)',
                text: '## 关键牌功能\n- **+4牌**：只有当手中没有与底牌颜色相同的牌时才能打出。',
                section_title: '知识库',
                distance: 0.18,
                score: 0.82,
                metadata: { game_id: 'uno' },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ reply: '**不能随便出。**', switch_to_recommendation: false }) } }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('answers directly without auto-appending hidden wiki evidence by default', async () => {
    expect(activeGame).toBeDefined();

    const result = await getLLMResponse(
      'UNO +4 能不能随便出？',
      'referee',
      activeGame,
      [],
      [],
    );

    expect(result.text).toContain('**不能随便出。**');
    expect(result.text).not.toContain('补充一点');
    expect(result.text).not.toContain('常见问题');
    expect(result.text).not.toContain('知识库');
  });

  it('answers stable win-condition questions directly from the local rulebook fields', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`Unexpected fetch URL: ${String(input)}`);
    });
    globalThis.fetch = fetchMock;

    const result = await getLLMResponse(
      'UNO 怎么才算赢？',
      'referee',
      activeGame,
      [],
      [],
    );

    expect(result.text).toContain('**赢法其实就一句话：**');
    expect(result.text).toContain('最先出完手牌');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes explicit evidence labels from display without exposing internal source copy', async () => {
    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'uno:faq:1',
                document_id: 'uno',
                title: 'UNO (优诺)',
                text: '- **Q: +4 可以随便出吗？**\n  - A: **不可以！** 只有没有同色牌时才能出。',
                section_title: '常见问题',
                distance: 0.12,
                score: 0.88,
                metadata: { game_id: 'uno' },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ reply: '**不能随便出。** [证据1]', switch_to_recommendation: false }) } }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      'UNO +4 能不能随便出？',
      'referee',
      activeGame,
      [],
      [],
    );

    expect(result.text).toContain('**不能随便出。**');
    expect(result.text).not.toContain('[证据1]');
    expect(result.text).not.toContain('常见问题');
    expect(result.text).not.toContain('参考依据');
  });

  it('skips referee retrieval for switch-intent control messages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ reply: '那我们换个模式。', switch_to_recommendation: true }) } }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    globalThis.fetch = fetchMock;

    const result = await getLLMResponse(
      '不玩这个了，换个游戏吧',
      'referee',
      activeGame,
      [],
      [],
    );

    expect(result.switchMode).toBe(true);
    expect(result.text).toContain('换个模式');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
  });

  it('keeps referee fallback answer natural when upstream LLM is unavailable', async () => {
    expect(halliGalli).toBeDefined();

    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'halli-galli:faq:1',
                document_id: 'halli-galli',
                title: '德国心脏病',
                text: '- **Q: 两个人同时拍怎么办？**\n  - A: 手在下面（最先接触铃铛）的人赢。',
                section_title: '常见问题',
                distance: 0.05,
                score: 0.96,
                metadata: { game_id: 'halli-galli' },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        throw new Error('upstream temporarily unavailable');
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      '两个人同时拍怎么办？',
      'referee',
      halliGalli,
      [],
      [],
    );

    expect(result.text).toContain('手在下面');
    expect(result.text).not.toContain('你可以试着问我');
    expect(result.text).not.toContain('目标：');
  });
});
