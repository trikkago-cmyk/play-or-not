import { describe, expect, it } from 'vitest';
import type { Game } from '@/types';
import { buildRecommendationProfile } from '../recommendationProfile';
import { GAME_DATABASE } from '../gameDatabase';

function makeGame(tags: string[]): Game {
  return {
    id: 'probe-game',
    titleCn: '测试游戏',
    titleEn: 'Probe Game',
    coverUrl: '/game-covers/probe.png',
    minPlayers: 2,
    maxPlayers: 4,
    playtimeMin: 20,
    ageRating: 8,
    complexity: 1.8,
    tags,
    oneLiner: '一款用于验证结构化标签归类的测试桌游。',
    rules: {
      target: '测试目标',
      flow: '测试流程',
      tips: '测试建议',
    },
    FAQ: '测试 FAQ',
    knowledgeBase: '测试知识库',
  };
}

describe('buildRecommendationProfile', () => {
  it('recognizes canonical structured tags directly from game tags', () => {
    const profile = buildRecommendationProfile(
      makeGame(['家庭同乐', '低冲突友好', '拼图布局', '纸笔规划']),
    );

    expect(profile.occasionTags).toContain('家庭同乐');
    expect(profile.moodTags).toContain('低冲突友好');
    expect(profile.mechanicTags).toContain('拼图布局');
    expect(profile.mechanicTags).toContain('纸笔规划');
  });

  it('does not treat tight two-player cooperation as a break-ice party game', () => {
    const skyTeam = GAME_DATABASE.find((game) => game.id === 'skyteam');

    expect(skyTeam).toBeDefined();
    expect(skyTeam?.recommendationProfile?.occasionTags).not.toContain('团建破冰');
  });

  it('does not infer paper-and-write mechanics from generic planning language', () => {
    const kingdomino = GAME_DATABASE.find((game) => game.id === 'kingdomino');

    expect(kingdomino).toBeDefined();
    expect(kingdomino?.recommendationProfile?.mechanicTags).not.toContain('纸笔规划');
  });

  it('treats modern-art as auction-market play instead of luck betting', () => {
    const modernArt = GAME_DATABASE.find((game) => game.id === 'modern-art');

    expect(modernArt).toBeDefined();
    expect(modernArt?.recommendationProfile?.mechanicTags).toContain('拍卖竞价');
    expect(modernArt?.recommendationProfile?.mechanicTags).not.toContain('拍卖押注');
  });
});
