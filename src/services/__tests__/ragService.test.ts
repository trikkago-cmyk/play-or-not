import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockGames } from '@/data/mockData';

import { DialogueAgent } from '../ragService';

const { getGameRecommendationMock, getGameRecommendationStreamMock, getSimilarGamesMock } = vi.hoisted(() => ({
  getGameRecommendationMock: vi.fn(),
  getGameRecommendationStreamMock: vi.fn(),
  getSimilarGamesMock: vi.fn(() => []),
}));

vi.mock('../llmService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llmService')>();

  return {
    ...actual,
    getGameRecommendation: getGameRecommendationMock,
    getGameRecommendationStream: getGameRecommendationStreamMock,
    getSimilarGames: getSimilarGamesMock,
  };
});

const avalon = mockGames.find((game) => game.titleCn === '阿瓦隆');
const splendor = mockGames.find((game) => game.titleCn === '璀璨宝石');

if (!avalon || !splendor) {
  throw new Error('Missing fixture games required for ragService tests');
}

describe('DialogueAgent recommendation session memory', () => {
  beforeEach(() => {
    getGameRecommendationMock.mockReset();
    getGameRecommendationStreamMock.mockReset();
    getSimilarGamesMock.mockReset();
    getSimilarGamesMock.mockReturnValue([]);
    getGameRecommendationMock.mockResolvedValue({
      text: '这轮先试试《阿瓦隆》。',
      game: avalon,
    });
    getGameRecommendationStreamMock.mockResolvedValue({
      text: '这轮先试试《阿瓦隆》。',
      game: avalon,
    });
  });

  it('keeps hard and mechanic constraints when a later turn only refines the vibe', async () => {
    const agent = new DialogueAgent(false);

    await agent.processInput('我们 6 个人，需要纸笔规划、图图写写的，轻松有趣一点。', 'recommendation');
    await agent.processInput('更轻松一点', 'recommendation');

    const latestOptions = getGameRecommendationMock.mock.calls.at(-1)?.[5];
    expect(latestOptions).toMatchObject({
      recommendationIntent: expect.objectContaining({
        requestedPlayerCount: 6,
        maxComplexity: expect.any(Number),
        desiredTags: expect.arrayContaining(['纸笔规划', '轻松休闲']),
        searchTerms: expect.arrayContaining(['纸笔', '写写画画']),
        lastAction: 'refine',
      }),
    });
  });

  it('clears a negated mechanic while keeping still-valid hard constraints', async () => {
    const agent = new DialogueAgent(false);

    await agent.processInput('我们 6 个人，需要纸笔规划、图图写写的，轻松有趣一点。', 'recommendation');
    await agent.processInput('不要纸笔，换成阵营推理', 'recommendation');

    const latestIntent = getGameRecommendationMock.mock.calls.at(-1)?.[5]?.recommendationIntent;
    expect(latestIntent).toMatchObject({
      requestedPlayerCount: 6,
      lastAction: 'override',
    });
    expect(latestIntent?.desiredTags).toContain('阵营推理');
    expect(latestIntent?.desiredTags).not.toContain('纸笔规划');
    expect(latestIntent?.excludedTags).toContain('纸笔规划');
  });

  it('overrides player count when the user changes that slot explicitly', async () => {
    const agent = new DialogueAgent(false);

    await agent.processInput('我们 6 个人，想要轻松热闹一点。', 'recommendation');
    await agent.processInput('改成两个人玩', 'recommendation');

    const latestIntent = getGameRecommendationMock.mock.calls.at(-1)?.[5]?.recommendationIntent;
    expect(latestIntent).toMatchObject({
      requestedPlayerCount: 2,
      requestedPlayerRangeMin: undefined,
      requestedPlayerRangeMax: undefined,
      lastAction: 'override',
    });
  });

  it('resets stale constraints when the user starts a new recommendation context', async () => {
    const agent = new DialogueAgent(false);

    await agent.processInput('我们 6 个人，需要纸笔规划、图图写写的。', 'recommendation');
    await agent.processInput('重新开始，推荐情侣双人桌游', 'recommendation');

    const latestIntent = getGameRecommendationMock.mock.calls.at(-1)?.[5]?.recommendationIntent;
    expect(latestIntent).toMatchObject({
      requestedPlayerCount: 2,
      lastAction: 'reset',
    });
    expect(latestIntent?.desiredTags).toContain('双人核心');
    expect(latestIntent?.desiredTags).not.toContain('纸笔规划');
    expect(latestIntent?.sourceTurns).toEqual(['重新开始，推荐情侣双人桌游']);
  });

  it('routes referee switch requests through the one-card recommendation path', async () => {
    const agent = new DialogueAgent(false);

    const result = await agent.processInput('算了，你都不知道，那还是换一个游戏吧', 'referee', splendor);

    expect(result.switchMode).toBe(true);
    expect(result.games).toEqual([avalon]);
    expect(result.games).toHaveLength(1);

    const latestCall = getGameRecommendationMock.mock.calls.at(-1);
    expect(latestCall?.[1]).toContain(splendor.id);
    expect(latestCall?.[3]).toBe('recommendation');
    expect(latestCall?.[4]).toBeUndefined();
  });

  it('restores short-term recommendation memory from a session snapshot', async () => {
    const originalAgent = new DialogueAgent(false);

    await originalAgent.processInput('我们 6 个人，需要纸笔规划、图图写写的，轻松有趣一点。', 'recommendation');

    const restoredAgent = new DialogueAgent(false);
    restoredAgent.restoreSnapshot(originalAgent.getSnapshot());

    await restoredAgent.processInput('换一个', 'recommendation');

    const latestIntent = getGameRecommendationMock.mock.calls.at(-1)?.[5]?.recommendationIntent;
    expect(latestIntent).toMatchObject({
      requestedPlayerCount: 6,
      lastAction: 'continue',
    });
    expect(latestIntent?.desiredTags).toEqual(expect.arrayContaining(['纸笔规划', '轻松休闲']));
  });

  it('does not inherit short-term memory after reset', async () => {
    const agent = new DialogueAgent(false);

    await agent.processInput('我们 6 个人，需要纸笔规划、图图写写的。', 'recommendation');
    agent.reset();
    await agent.processInput('换一个', 'recommendation');

    const latestIntent = getGameRecommendationMock.mock.calls.at(-1)?.[5]?.recommendationIntent;
    expect(latestIntent?.requestedPlayerCount).toBeUndefined();
    expect(latestIntent?.lastAction).toBe('new');
  });
});
