import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLLMResponse, setLLMConfig } from './src/services/llmService';

// Mock fetch globally
global.fetch = vi.fn();

describe('LLM Response Parsing Golden Datasets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // 强制设定配置以防转模拟模式
        setLLMConfig('fake-key', 'volcengine');
    });

    const createMockResponse = (jsonPayload) => {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                choices: [{
                    message: {
                        content: typeof jsonPayload === 'string' ? jsonPayload : JSON.stringify(jsonPayload)
                    }
                }]
            })
        }) as any;
    };

    it('Golden Dataset 1: Should prioritize JSON recommendation_id over text hallucination', async () => {
        const payload = {
            thought: "由于用户提到了农场主，所以我推荐同一等级的经典游戏波多黎各",
            reply: "既然你喜欢《农场主》这种深度策略游戏，那我正经推荐一款：\n\n《波多黎各》\n\n- 经典德式策略",
            recommendation_name: "波多黎各",
            recommendation_id: "puerto-rico"
        };

        (global.fetch as any).mockImplementation(() => createMockResponse(payload));

        const result = await getLLMResponse('我喜欢农场主', 'recommendation');

        // Expect the ID to be explicitly puerto-rico, NOT agricola
        expect(result.gameId).toBe('puerto-rico');
    });

    it('Golden Dataset 2: Should use Text fallback if JSON id is missing but text mentions only one game', async () => {
        const payload = {
            thought: "忘记填 JSON ID 了",
            reply: "强烈推荐你玩一下《卡卡颂》，拼接板块非常有意思。",
        };

        (global.fetch as any).mockImplementation(() => createMockResponse(payload));

        const result = await getLLMResponse('推荐个游戏', 'recommendation');

        // Expect text parsing fallback works
        expect(result.gameId).toBe('carcassonne');
    });

    it('Golden Dataset 3: Should use the LAST mentioned game if multiple games are in text and JSON id is missing', async () => {
        const payload = {
            thought: "忘记填 JSON ID 了",
            reply: "你之前玩过《狼人杀》对吧？那我推荐更烧脑的《阿瓦隆》！",
            recommendation_id: null
        };

        (global.fetch as any).mockImplementation(() => createMockResponse(payload));

        const result = await getLLMResponse('推荐个阵营游戏', 'recommendation');

        // Default parser should pick the last one mentioned (Avalon) 
        // since we changed `detectedGames[detectedGames.length - 1]`
        expect(result.gameId).toBe('avalon');
    });

    it('Golden Dataset 4: Should return unknownGame field if target game is not in database', async () => {
        const payload = {
            thought: "用户询问的游戏不在库中",
            reply: "抱歉，本地库中没有《血染钟楼》。这是一款基于狼人杀的进阶游戏...",
            recommendation_id: null,
            unknown_target_game: "血染钟楼"
        };

        (global.fetch as any).mockImplementation(() => createMockResponse(payload));

        const result = await getLLMResponse('教我玩血染钟楼', 'recommendation');

        expect(result.unknownGame).toBe('血染钟楼');
        expect(result.gameId).toBeNull();
    });
});
