import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GAME_DATABASE } from '@/data/gameDatabase';
import { getGameRecommendation, getGameRecommendationStream, getLLMResponse, initLLMConfig } from '../llmService';

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

    it('should short-circuit pure meta chat queries without forcing a recommendation turn', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as any;

        const result = await getGameRecommendation("你是谁");

        expect(result.text).toContain('我是洛思');
        expect(result.game).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should short-circuit greeting-style smalltalk without recommending a game card', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as any;

        const result = await getGameRecommendation("你好，洛思");

        expect(result.text).toContain('在呢');
        expect(result.text).toContain('判规则');
        expect(result.game).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
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

        expect(result.text).toContain('《');
        expect(result.text).not.toContain('返回格式错误');
        expect(result.gameId).toBeDefined();
    });

    it('should still attach a recommendation card when the model returns one plain-text game without JSON', async () => {
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
                        choices: [{ message: { content: '这局我会先推 **《阿瓦隆》**。6个人玩它最容易把桌上气氛带起来。' } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse('推荐一个 6 人聚会桌游');

        expect(result.text).toContain('《阿瓦隆》');
        expect(result.gameId).toBe('avalon');
    });

    it('should rewrite multi-game plain-text answers back to one local recommendation with a card', async () => {
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
                    })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: '我给你几个选择：《机密代号》、《阿瓦隆》、《炸弹猫》。如果想最稳一点，也可以都看看。' } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse('推荐一个 6 人聚会桌游');

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(6);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(6);
        expect(result.text).toContain(`《${recommendedGame!.titleCn}》`);
        expect(result.text).not.toContain('《机密代号》');
        expect(result.text).not.toContain('《炸弹猫》');
        expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
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

        const result = await getLLMResponse('推荐一个2-4人的桌游');

        const chatCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/chat'));
        const chatInit = chatCall?.[1];
        const chatBody = JSON.parse(String((chatInit && 'body' in chatInit ? chatInit.body : undefined) || '{}'));
        const systemPrompt = chatBody.messages?.[0]?.content ?? '';
        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);

        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
        expect(systemPrompt).toContain('2-4 人都能成立');
        expect(systemPrompt).toContain('双人核心');
        expect(systemPrompt).toContain('3到4人佳');
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(2);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(4);
    });

    it('should send all atomic recommendation constraints as hard metadata filters', async () => {
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
                        choices: [{ message: { content: JSON.stringify({ reply: '我先推荐 **《一夜终极狼人》**。', recommendation_id: 'werewolf-one-night' }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        globalThis.fetch = fetchMock;

        const result = await getLLMResponse('推荐一个9人局家庭聚会，30分钟内，规则简单，8岁孩子也能玩的桌游');

        const chatCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/chat'));
        const chatInit = chatCall?.[1];
        const chatBody = JSON.parse(String((chatInit && 'body' in chatInit ? chatInit.body : undefined) || '{}'));
        const systemPrompt = chatBody.messages?.[0]?.content ?? '';
        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);

        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
        expect(systemPrompt).toContain('9 人局');
        expect(systemPrompt).toContain('30分钟内');
        expect(systemPrompt).toContain('8岁可玩');
        expect(systemPrompt).toContain('家庭同乐');
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(9);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(9);
        expect(recommendedGame!.playtimeMin).toBeLessThanOrEqual(30);
        expect(recommendedGame!.complexity).toBeLessThanOrEqual(2.4);
        expect(recommendedGame!.ageRating).toBeLessThanOrEqual(8);
    });

    it('should treat explicit high-complexity requests as a hard metadata filter', async () => {
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
                        choices: [{ message: { content: JSON.stringify({ reply: '我先推荐 **《殖民火星》**。', recommendation_id: 'terraforming-mars' }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        globalThis.fetch = fetchMock;

        const result = await getLLMResponse('推荐一个2人复杂度3以上的桌游');
        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);

        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(2);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(2);
        expect(recommendedGame!.complexity).toBeGreaterThanOrEqual(3);
    });

    it('should not confuse a 9-player party request with a 9-year-old age filter', async () => {
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
                        choices: [{ message: { content: JSON.stringify({ reply: '我先推荐 **《一夜终极狼人》**。', recommendation_id: 'werewolf-one-night' }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        globalThis.fetch = fetchMock;

        const result = await getLLMResponse('九人局家庭聚会，来个轻松点的');
        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);

        expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/rag'))).toBe(false);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(9);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(9);
    });

    it('should reject age or complexity incompatible model picks even if the model names them', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'raceforthegalaxy:recommendation:1',
                                document_id: 'raceforthegalaxy',
                                title: '银河竞逐',
                                text: '适合 2-6 人、60 分钟左右的硬核引擎构筑局。',
                                section_title: '推荐词条',
                                distance: 0.01,
                                score: 0.95,
                                metadata: { game_id: 'raceforthegalaxy' },
                            },
                            {
                                chunk_id: 'dobble:recommendation:1',
                                document_id: 'dobble',
                                title: '哆宝 (Dobble)',
                                text: '适合 2-8 人、15 分钟左右的轻松反应聚会局，小朋友也能上手。',
                                section_title: '推荐词条',
                                distance: 0.08,
                                score: 0.82,
                                metadata: { game_id: 'dobble' },
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
                            reply: '这局我会先推 **《银河竞逐》**。',
                            recommendation_name: '银河竞逐',
                            recommendation_id: 'raceforthegalaxy',
                        }) } }],
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse('推荐一个8岁孩子能玩、规则简单的聚会桌游');

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.ageRating).toBeLessThanOrEqual(8);
        expect(recommendedGame!.complexity).toBeLessThanOrEqual(2.4);
        expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
        expect(result.text).not.toContain('**《银河竞逐》**');
    });

    it('should let stronger intent fit outrank a higher-retrieval but lighter candidate', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'castlecombo:recommendation:1',
                                document_id: 'castlecombo',
                                title: '城堡嘉年华',
                                text: '适合 2-5 人的家庭轻策略拼图局，带新手上桌很顺。',
                                section_title: '推荐词条',
                                distance: 0.03,
                                score: 0.97,
                                metadata: { game_id: 'castlecombo' },
                            },
                            {
                                chunk_id: 'raceforthegalaxy:recommendation:1',
                                document_id: 'raceforthegalaxy',
                                title: '银河竞逐',
                                text: '适合 2-6 人的硬核引擎构筑局，更偏烧脑策略。',
                                section_title: '推荐词条',
                                distance: 0.19,
                                score: 0.55,
                                metadata: { game_id: 'raceforthegalaxy' },
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

        const result = await getLLMResponse('推荐一个2人烧脑桌游');

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(2);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(2);
        expect(recommendedGame!.complexity).toBeGreaterThanOrEqual(2.6);
        expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
        expect(result.text).not.toContain('**《城堡嘉年华》**');
    });

    it('should use BGA popularity to break ties before raw retrieval similarity', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'resarcana:recommendation:1',
                                document_id: 'resarcana',
                                title: '奥法对决',
                                text: '适合 2-5 人的短局引擎构筑对战，决策很紧。',
                                section_title: '推荐词条',
                                distance: 0.01,
                                score: 0.96,
                                metadata: { game_id: 'resarcana' },
                            },
                            {
                                chunk_id: 'raceforthegalaxy:recommendation:1',
                                document_id: 'raceforthegalaxy',
                                title: '银河竞逐',
                                text: '适合 2-6 人的硬核引擎构筑局，更偏烧脑策略。',
                                section_title: '推荐词条',
                                distance: 0.12,
                                score: 0.7,
                                metadata: { game_id: 'raceforthegalaxy' },
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

        const result = await getLLMResponse('推荐一个2人烧脑引擎构筑桌游');

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(2);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(2);
        expect([
            ...(recommendedGame!.recommendationProfile?.allTags ?? []),
            ...recommendedGame!.tags,
            recommendedGame!.oneLiner,
        ].join(' ')).toContain('引擎');
        expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
        expect(result.text).not.toContain('**《奥法对决》**');
    });

    it('should keep max-playtime as a hard compatibility gate in the final recommendation', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'seasons:recommendation:1',
                                document_id: 'seasons',
                                title: '四季物语',
                                text: '适合 2-4 人、18 分钟左右的烧脑引擎构筑局。',
                                section_title: '推荐词条',
                                distance: 0.08,
                                score: 0.82,
                                metadata: { game_id: 'seasons' },
                            },
                            {
                                chunk_id: 'raceforthegalaxy:recommendation:1',
                                document_id: 'raceforthegalaxy',
                                title: '银河竞逐',
                                text: '适合 2-6 人、60 分钟左右的硬核引擎构筑局。',
                                section_title: '推荐词条',
                                distance: 0.01,
                                score: 0.95,
                                metadata: { game_id: 'raceforthegalaxy' },
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
                            reply: '这局我会先推 **《银河竞逐》**。',
                            recommendation_name: '银河竞逐',
                            recommendation_id: 'raceforthegalaxy',
                        }) } }],
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse('推荐一个30分钟内的烧脑桌游');

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.playtimeMin).toBeLessThanOrEqual(30);
        expect(recommendedGame!.complexity).toBeGreaterThanOrEqual(2.6);
        expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
        expect(result.text).not.toContain('**《银河竞逐》**');
    });

  it('should retry the upstream LLM on the next turn instead of latching the whole session into mock mode', async () => {
        let chatCalls = 0;

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
                    })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                chatCalls += 1;

                if (chatCalls === 1) {
                    throw new Error('temporary upstream failure');
                }

                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ reply: '第二次我已经恢复了，推荐 **《阿瓦隆》**。', recommendation_name: '阿瓦隆', recommendation_id: 'avalon' }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const first = await getLLMResponse('推荐一个 6 人聚会桌游');
        const second = await getLLMResponse('推荐一个 6 人聚会桌游');

        const firstGame = GAME_DATABASE.find((game) => first.gameId === game.id);
        const secondGame = GAME_DATABASE.find((game) => second.gameId === game.id);
        expect(firstGame).toBeDefined();
        expect(secondGame).toBeDefined();
        expect(first.text).toContain(`**《${firstGame!.titleCn}》**`);
        expect(second.text).toContain(`**《${secondGame!.titleCn}》**`);
        expect(second.text).toContain('- **');
        expect(chatCalls).toBe(2);
  });

  it('should use DeepSeek-V3.2 for recommendation turns', async () => {
    let observedModel = '';

    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({ hits: [] }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        observedModel = JSON.parse(String(init?.body || '{}')).model;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ reply: '我会先推 **《阿瓦隆》**。', recommendation_name: '阿瓦隆', recommendation_id: 'avalon' }) } }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await getLLMResponse('推荐一个 6 人聚会桌游');

    expect(observedModel).toBe('deepseek-v3-2-251201');
  });

  it('should keep DeepSeek-V3.2 for referee turns', async () => {
    let observedModel = '';

    (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/api/rag')) {
        return {
          ok: true,
          json: async () => ({ hits: [] }),
        } as Response;
      }

      if (url.includes('/api/chat')) {
        observedModel = JSON.parse(String(init?.body || '{}')).model;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ reply: '**大致流程是这样的：** 先翻牌，再结算。', switch_to_recommendation: false }) } }],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await getLLMResponse('这回合先干嘛？', 'referee', {
      id: 'test-game',
      titleCn: '测试游戏',
      titleEn: 'Test Game',
      minPlayers: 2,
      maxPlayers: 4,
      playtimeMin: 30,
      playtimeMax: 30,
      age: '8+',
      complexity: 1,
      category: [],
      mechanics: [],
      oneLiner: '测试',
      tags: [],
      rules: { target: '', flow: '', tips: '' },
      knowledgeBase: '',
      FAQ: '',
    } as any);

    expect(observedModel).toBe('deepseek-v3-2-251201');
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
        expect(result.game!.minPlayers).toBeLessThanOrEqual(2);
        expect(result.game!.maxPlayers).toBeGreaterThanOrEqual(4);
        expect(result.text).toContain(`《${result.game!.titleCn}》`);
        expect(result.text).not.toContain('《哆宝》');
        expect((globalThis.fetch as any).mock.calls.some(([input]: [RequestInfo | URL]) => String(input).includes('/api/rag'))).toBe(false);
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

    it('should keep the requested player constraint when the user is correcting a bad previous recommendation', async () => {
        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'concept:recommendation:1',
                                document_id: 'concept',
                                title: '妙不可言',
                                text: '适合 2 到 12 人的聚会猜词局，家庭聚会很容易把全桌带热。',
                                section_title: '推荐词条',
                                distance: 0.08,
                                score: 0.93,
                                metadata: { game_id: 'concept' },
                            },
                        ],
                    })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({
                            reply: '我还是想推 **《FlipToons》**，因为轻松可爱。',
                            recommendation_name: 'FlipToons',
                            recommendation_id: 'fliptoons'
                        }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendation('我不是让你推荐9人局家庭聚会吗？怎么给我推荐1到4人的？');

        expect(result.game).toBeDefined();
        expect(result.game?.id).not.toBe('fliptoons');
        expect(result.game!.minPlayers).toBeLessThanOrEqual(9);
        expect(result.game!.maxPlayers).toBeGreaterThanOrEqual(9);
        expect(result.text).toContain('- **');
    });

    it('should inherit session constraints when the user asks to change the recommendation', async () => {
        let observedSystemPrompt = '';

        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({ hits: [] })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                const chatBody = JSON.parse(String(init?.body || '{}'));
                observedSystemPrompt = chatBody.messages?.[0]?.content ?? '';

                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({
                            reply: '那我强烈推荐 **《失落的城市》**，两个人默契升温。',
                            recommendation_name: '失落的城市',
                            recommendation_id: 'lostcities'
                        }) } }]
                    })
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getLLMResponse(
            '换一个',
            'recommendation',
            undefined,
            [
                {
                    role: 'user',
                    content: '6 个人，需要纸笔规划、图图写写的，有种轻松有趣的氛围。',
                },
                {
                    role: 'assistant',
                    content: '我会先推 **《王国制图师》**。',
                },
            ],
            ['cartographers'],
        );

        const recommendedGame = GAME_DATABASE.find((game) => game.id === result.gameId);
        const recommendationTags = [
            ...(recommendedGame?.recommendationProfile?.allTags ?? []),
            ...(recommendedGame?.tags ?? []),
            recommendedGame?.oneLiner ?? '',
        ].join(' ');

        expect(observedSystemPrompt).toContain('上一轮仍有效的需求');
        expect(observedSystemPrompt).toContain('6 个人');
        expect(observedSystemPrompt).toContain('纸笔规划');
        expect(recommendedGame).toBeDefined();
        expect(recommendedGame!.id).not.toBe('lostcities');
        expect(recommendedGame!.minPlayers).toBeLessThanOrEqual(6);
        expect(recommendedGame!.maxPlayers).toBeGreaterThanOrEqual(6);
        expect(recommendationTags).toContain('纸笔规划');
        expect(result.text).toContain(`**《${recommendedGame!.titleCn}》**`);
    });

    it('should not leak reasoning text into the visible streaming preview and should use the completed payload as final text', async () => {
        const previewUpdates: string[] = [];
        const encoder = new TextEncoder();
        const sseFrames = [
            'event: response.reasoning.delta\ndata: {"delta":"先看一下候选里哪个更稳"}\n\n',
            'event: response.output_text.delta\ndata: {"delta":"{\\"thought\\":\\"先卡人数\\",\\"reply\\":\\""}\n\n',
            'event: response.output_text.delta\ndata: {"delta":"按你们这局，我会先推 **《阿瓦隆》**。\\\\n\\\\n- **桌上戏很多**：九个人坐满也不容易冷场。"}\n\n',
            'event: response.completed\ndata: {"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"{\\"reply\\":\\"按你们这局，我会先推 **《阿瓦隆》**。\\\\n\\\\n- **桌上戏很多**：九个人坐满也不容易冷场。\\\\n- **人数真能开**：它本来就吃 5 到 10 人的大场面。\\\\n\\\\n如果你们今晚想要的是全桌一起演起来的感觉，它很稳。\\",\\"recommendation_name\\":\\"阿瓦隆\\",\\"recommendation_id\\":\\"avalon\\"}"}]}]}\n\n',
            'data: [DONE]\n\n',
        ];

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
                    })
                } as Response;
            }

            if (url.includes('/api/chat')) {
                const stream = new ReadableStream({
                    start(controller) {
                        for (const frame of sseFrames) {
                            controller.enqueue(encoder.encode(frame));
                        }
                        controller.close();
                    },
                });

                return new Response(stream, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                    },
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendationStream(
            '推荐一个九人局家庭聚会玩的',
            [],
            [],
            'recommendation',
            undefined,
            {
                onReplyUpdate: (text) => {
                    previewUpdates.push(text);
                },
            },
        );

        expect(previewUpdates.some((text) => text.includes('先看一下候选'))).toBe(false);
        expect(previewUpdates.some((text) => text.includes('先卡人数'))).toBe(false);
        expect(result.game).toBeDefined();
        expect(result.game!.minPlayers).toBeLessThanOrEqual(9);
        expect(result.game!.maxPlayers).toBeGreaterThanOrEqual(9);
        expect(result.text).toContain(`《${result.game!.titleCn}》`);
        expect(result.text).toContain('- **');
    });

    it('should preserve a valid streamed recommendation instead of replacing it with the local fallback template', async () => {
        const previewUpdates: string[] = [];
        const encoder = new TextEncoder();
        const completedReply = '这局我会先推 **《爆炸猫》**。\n\n- **互相埋雷**：抽牌像拆盲盒，大家一边嘴硬一边怕摸到那只猫，气氛很快就能热起来。\n\n如果你们想要的是轻松、好笑、还能互相坑一下，它比规规矩矩讲策略更适合。';
        const streamedJsonPrefix = `{"reply":"${completedReply.replace(/\n/g, '\\n').replace(/"/g, '\\"')}`;
        const completedJson = JSON.stringify({
            reply: completedReply,
            recommendation_name: '爆炸猫',
            recommendation_id: 'exploding-kittens',
        });
        const completedPayload = JSON.stringify({
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        {
                            type: 'output_text',
                            text: completedJson,
                        },
                    ],
                },
            ],
        });
        const sseFrames = [
            `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: streamedJsonPrefix })}\n\n`,
            `event: response.completed\ndata: ${completedPayload}\n\n`,
            'data: [DONE]\n\n',
        ];

        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'exploding-kittens:recommendation:1',
                                document_id: 'exploding-kittens',
                                title: '爆炸猫',
                                text: '轻松聚会卡牌，适合 2 到 5 人，核心体验是抽牌、埋雷、互相坑。',
                                section_title: '推荐词条',
                                distance: 0.08,
                                score: 0.92,
                                metadata: { game_id: 'exploding-kittens' },
                            },
                        ],
                    }),
                } as Response;
            }

            if (url.includes('/api/chat')) {
                const stream = new ReadableStream({
                    start(controller) {
                        for (const frame of sseFrames) {
                            controller.enqueue(encoder.encode(frame));
                        }
                        controller.close();
                    },
                });

                return new Response(stream, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream; charset=utf-8',
                    },
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendationStream(
            '4个人轻松聚会，想要互相捉弄一点',
            [],
            [],
            'recommendation',
            undefined,
            {
                onReplyUpdate: (text) => {
                    previewUpdates.push(text);
                },
            },
        );

        expect(previewUpdates.at(-1)).toContain('互相埋雷');
        expect(result.game?.id).toBe('exploding-kittens');
        expect(result.text).toContain('互相埋雷');
        expect(result.text).toContain('抽牌像拆盲盒');
        expect(result.text).not.toContain('4人正合适');
        expect(result.text).not.toContain('新手不掉队');
        expect(result.text).not.toContain('越玩越有画面');
    });

    it('should clean generic recommendation headings in place without discarding the model copy', async () => {
        const modelReply = '这局我会先推 **《爆炸猫》**。\n\n- **推荐理由**：抽牌像拆盲盒，互相埋雷很上头。\n\n它很适合想轻松笑一局的人。';

        (globalThis.fetch as any).mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);

            if (url.includes('/api/rag')) {
                return {
                    ok: true,
                    json: async () => ({
                        hits: [
                            {
                                chunk_id: 'exploding-kittens:recommendation:1',
                                document_id: 'exploding-kittens',
                                title: '爆炸猫',
                                text: '轻松聚会卡牌，适合 2 到 5 人，核心体验是抽牌、埋雷、互相坑。',
                                section_title: '推荐词条',
                                distance: 0.08,
                                score: 0.92,
                                metadata: { game_id: 'exploding-kittens' },
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
                            reply: modelReply,
                            recommendation_name: '爆炸猫',
                            recommendation_id: 'exploding-kittens',
                        }) } }],
                    }),
                } as Response;
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        const result = await getGameRecommendation('4个人轻松聚会，想要互相捉弄一点');

        expect(result.game?.id).toBe('exploding-kittens');
        expect(result.text).toContain('抽牌像拆盲盒');
        expect(result.text).toContain('互相埋雷');
        expect(result.text).not.toContain('推荐理由');
        expect(result.text).not.toContain('4人正合适');
    });
});
