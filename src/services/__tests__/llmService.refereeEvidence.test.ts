import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_DATABASE } from '@/data/gameDatabase';
import { getLLMResponse, initLLMConfig } from '../llmService';

describe('llmService referee evidence guardrail', () => {
  const activeGame = GAME_DATABASE.find((game) => game.id === 'uno');

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

  it('appends a reference block when the referee answer lacks explicit citations', async () => {
    expect(activeGame).toBeDefined();

    const result = await getLLMResponse(
      'UNO +4 能不能随便出？',
      'referee',
      activeGame,
      [],
      [],
    );

    expect(result.text).toContain('**参考依据**');
    expect(result.text).toContain('[证据1]');
    expect(result.text).toContain('UNO (优诺) / 常见问题');
  });

  it('preserves explicit evidence labels and resolves them into the reference block', async () => {
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

    expect(result.text).toContain('**不能随便出。** [证据1]');
    expect(result.text).toContain('**参考依据**');
    expect(result.text).toContain('[证据1] UNO (优诺) / 常见问题');
    expect(result.text).not.toContain('[证据2] UNO (优诺) / 知识库');
  });

  it('strips unsupported evidence labels and falls back to known references', async () => {
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
            choices: [{ message: { content: JSON.stringify({ reply: '**不能随便出。** [证据9]', switch_to_recommendation: false }) } }],
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
    expect(result.text).not.toContain('[证据9]');
    expect(result.text).toContain('**参考依据**');
    expect(result.text).toContain('[证据1] UNO (优诺) / 常见问题');
    expect(result.text).toContain('[证据2] UNO (优诺) / 知识库');
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
});
