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

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(6);
    expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(6);
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).not.toContain('召回');
    expect(result.text).not.toContain('候选池');
    expect(result.text).not.toContain('recommendation_id');
    expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
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

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).not.toContain('召回');
    expect(result.text).not.toContain('最稳');
    expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
  });

  it('rewrites recommendation replies when the upstream model leaks wiki section markers', async () => {
    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({
            hits: [
              {
                chunk_id: 'flamingpyramids:recommendation:1',
                document_id: 'flamingpyramids',
                title: '燃烧金字塔',
                text: '[适合场景] 把不同材质的砖块往金字塔上怼，塌方、起火、爆炸都算常规操作；你只要比别人更早把牌清空就行。',
                section_title: '适合场景',
                distance: 0.05,
                score: 0.96,
                metadata: { game_id: 'flamingpyramids' },
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
                  reply: '如果这局想把气氛很快带起来，那我会把 **《燃烧金字塔》** 推给你。\n\n它最抓人的地方是：[适合场景] 把不同材质的砖块往金字塔上怼，塌方、起火、爆炸都算常规操作。\n- **为什么适合你们这局：** 而且 **6人** 基本就在它的舒服区间。',
                  recommendation_name: '燃烧金字塔',
                  recommendation_id: 'flamingpyramids',
                }),
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      '推荐一个6人聚会桌游，最好气氛能马上热起来，别太烧脑，30到45分钟。',
      'recommendation',
      undefined,
      [],
      [],
    );

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(6);
    expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(6);
    expect(recommendedGame!.playtimeMin).toBeLessThanOrEqual(45);
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).not.toContain('[适合场景]');
    expect(result.text).not.toContain('结构化词条');
    expect(result.text).not.toContain('好玩点');
    expect(result.text).not.toContain('更容易上头的地方');
    expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
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

  it('keeps recommendation fallback in DM-selling style when the upstream LLM is unavailable', async () => {
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
                text: '适合 5 到 10 人的阵营推理聚会局，桌上戏很多。',
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
        throw new Error('upstream temporarily unavailable');
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

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(6);
    expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(6);
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).not.toContain('召回');
    expect(result.text).not.toContain('人数支持');
    expect(result.text).not.toContain('体验关键词');
    expect(result.text).not.toContain('好玩点');
    expect(result.text).not.toContain('这局为什么会中它');
    expect(result.text).not.toContain('最抓人的点');
    expect(result.text).not.toContain('再补一个爽点');
    expect(result.text).not.toContain('推荐理由');
    expect(result.text).toContain('**气氛升温**');
    expect(result.text).toContain('**6人正合适**');
    expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
  });

  it('rewrites rigid upstream recommendation headings into concrete game traits', async () => {
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
                text: '适合 5 到 10 人的阵营推理聚会局，桌上戏很多。',
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
                  reply: '我会先推 **《阿瓦隆》**。\n\n- **这局为什么会中它**：它适合聚会。\n- **最抓人的点**：互相试探。\n- **再补一个爽点**：有翻盘。',
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

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).not.toContain('这局为什么会中它');
    expect(result.text).not.toContain('最抓人的点');
    expect(result.text).not.toContain('再补一个爽点');
    expect(result.text).toContain('**气氛升温**');
    expect(result.text).toContain('**6人正合适**');
    expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
  });

  it('rewrites awkward pseudo-poetic recommendation copy into plain DM language', async () => {
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
                text: '适合 5 到 10 人的阵营推理聚会局，桌上戏很多。',
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
                  reply: '如果你想找一款规则不压人、但决策很有味道的，我会先推 **《阿瓦隆》**。\n\n- **决策有后劲**：一款适合 5-10 人的阵营推理桌游。\n- **6人不掉线**：而且 6 人基本就在它的舒服区间。\n- **3人局最佳节奏**：3人局是公认的甜点区。\n- **越玩越有账**：后劲很足，后面都会回来找你算账。',
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

    const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
    expect(recommendedGame).toBeDefined();
    expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    expect(result.text).toContain('**气氛升温**');
    expect(result.text).toContain('**6人正合适**');
    expect(result.text).not.toContain('决策有后劲');
    expect(result.text).not.toContain('越玩越有账');
    expect(result.text).not.toContain('决策很有味道');
    expect(result.text).not.toContain('舒服区间');
    expect(result.text).not.toContain('甜点区');
    expect(result.text).not.toContain('sweet spot');
    expect(result.text).not.toContain('不掉线');
    expect(result.text).not.toContain('回来找你算账');
  });

  it('keeps recommendation prompts locked to one game even when the user asks for several options', async () => {
    let systemPrompt = '';

    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
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
        const body = JSON.parse(String(init?.body || '{}'));
        systemPrompt = body.messages?.[0]?.content || '';

        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  reply: '我先把 **《阿瓦隆》** 摆在前面。',
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

    await getLLMResponse(
      '给我几个 6 人聚会桌游备选，最好一个偏嘴炮、一个偏轻松、一个偏推理',
      'recommendation',
      undefined,
      [],
      [],
    );

    expect(systemPrompt).toContain('每次只专注推荐 **1款**');
    expect(systemPrompt).toContain('只围绕这一款游戏列 **2 到 3 个很短的点**');
    expect(systemPrompt).toContain('加粗部分必须是具体体验标签');
    expect(systemPrompt).toContain('禁止使用这些小标题');
    expect(systemPrompt).toContain('不要在同一轮里同时推荐多款游戏');
    expect(systemPrompt).not.toContain('2 到 3 款** 本地库游戏');
  });

  it('normalizes known bad Clocktower title variants before showing the reply', async () => {
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
                  reply: '这局我会推 **《染血钟tower》**。九个人一起互相盘身份，死了也不离桌，整晚都会有人憋笑和甩锅。',
                  recommendation_name: '染血钟楼',
                  recommendation_id: 'blood-on-the-clocktower',
                }),
              },
            }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const result = await getLLMResponse(
      '九人局想玩嘴炮和阵营推理，最好热闹一点',
      'recommendation',
      undefined,
      [],
      [],
    );

    expect(result.gameId).toBe('blood-on-the-clocktower');
    expect(result.text).toContain('**《血染钟楼》**');
    expect(result.text).not.toContain('染血钟楼');
    expect(result.text).not.toContain('染血钟tower');
    expect(result.text).not.toContain('Blood on the Clocktower');
  });
});
