import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGameRecommendation, getLLMResponse, initLLMConfig } from '../llmService';

describe('llmService Recommendation Consistency', () => {
    beforeEach(() => {
        initLLMConfig(); // Set initial config
        globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            return undefined as unknown as Response;
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should prioritize the game name extracted from the markdown text over the JSON ID', async () => {
        // Mock the LLM returning an incorrect JSON ID but correct text name
        const mockResponseText = JSON.stringify({
            reply: "根据你的描述，我觉得 **《阿瓦隆》** 很适合！\\n\\n- 身份推理，非常热闹",
            recommendation_name: "卡坦岛", // LLM confused the name
            recommendation_id: "catan" // LLM confused the ID
        });

        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: mockResponseText } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendation("推荐一个聚会游戏", ["catan"]);

        // The parser should extract "阿瓦隆" from the reply and match it to GAME_DATABASE
        expect(result.game).toBeDefined();
        expect(result.game?.id).toBe('avalon'); // Not catan!
    });

    it('should still return the game even if it was in the excludeIds array', async () => {
        // Mock the LLM recommending avalon exactly
        const mockResponseText = JSON.stringify({
            reply: "根据你的描述，我觉得 **《阿瓦隆》** 很适合！",
            recommendation_name: "阿瓦隆",
            recommendation_id: "avalon"
        });

        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: mockResponseText } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        // We pass avalon in excludeIds (e.g. it was just recommended)
        const result = await getGameRecommendation("推荐一个聚会游戏", ["avalon"]);

        // It should STILL return avalon because it was explicitly recommended
        expect(result.game).toBeDefined();
        expect(result.game?.id).toBe('avalon');
    });

    it('should skip recommendation retrieval for pure meta chat queries', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ reply: "我是你的桌游 DM，可以帮你推荐游戏。", recommendation_id: null }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        globalThis.fetch = fetchMock;

        const result = await getGameRecommendation("你是谁");

        expect(result.text).toContain('桌游 DM');
        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
    });

    it('should not expose raw JSON format errors to the user when the model returns plain text', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: '当然可以，4 个人破冰我会先推荐《阿瓦隆》或《机密代号》。' } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse('推荐一个 4 人破冰桌游');

        expect(result.text).toContain('阿瓦隆');
        expect(result.text).not.toContain('返回格式错误');
    });

    it('should structure 2-4 player queries as a full player-range retrieval request', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ reply: '我先推荐 **《石器时代》**。', recommendation_id: 'stoneage' }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        globalThis.fetch = fetchMock;

        await getLLMResponse('推荐一个2-4人的桌游');

        const ragCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/rag'));
        expect(ragCall).toBeDefined();

        const ragInit = ragCall?.[1];
        const ragBody = JSON.parse(String((ragInit && 'body' in ragInit ? ragInit.body : undefined) || '{}'));
        expect(ragBody.query).toContain('双人核心');
        expect(ragBody.query).toContain('3到4人佳');
        expect(ragBody.where).toEqual({
            $and: [
                { mode: 'recommendation' },
                { min_players: { $lte: 2 } },
                { max_players: { $gte: 4 } },
            ],
        });
    });

    it('should fall back to the top candidate when the model picks a local game outside the candidate pool', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'stoneage:recommendation:1',
                                document_id: 'recommendation:stoneage',
                                title: '石器时代',
                                text: '适合 2-5 人，工人放置和骰子驱动结合，2 到 4 人都能稳定开。',
                                section_title: '适合场景',
                                distance: 0.11,
                                score: 1.24,
                                metadata: {
                                    game_id: 'stoneage',
                                    mode: 'recommendation',
                                    knowledge_tier: 'catalog',
                                    section_title: '适合场景',
                                },
                            },
                        ],
                    }),
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({
                            reply: '2-4 人我会先推 **《哆宝》**，因为它最简单热闹。',
                            recommendation_name: '哆宝 (Dobble)',
                            recommendation_id: 'dobble'
                        }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendation('推荐一个2-4人的桌游');

        expect(result.game).toBeDefined();
        expect(result.game?.id).toBe('stoneage');
        expect(result.text).toContain('《石器时代》');
        expect(result.text).not.toContain('《哆宝》');
    });

    it('should not default to dobble for sparse 2-4 player queries when using the local shortlist fallback', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: '{推荐一个 2-4 人都能玩的吧' } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendation('推荐一个2-4人的桌游');

        expect(result.game).toBeDefined();
        expect(result.game?.id).not.toBe('dobble');
        expect(result.game!.minPlayers).toBeLessThanOrEqual(2);
        expect(result.game!.maxPlayers).toBeGreaterThanOrEqual(4);
    });
});
