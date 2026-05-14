import { beforeEach, describe, expect, it } from 'vitest';

import {
  getPersistentContextForPrompt,
  getUserMemory,
  recordPreferenceFromUserTurn,
  setActiveMemoryOwner,
} from '../memoryService';

describe('memoryService long-term preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveMemoryOwner();
  });

  it('stores stable preference signals by account owner', () => {
    recordPreferenceFromUserTurn('我更喜欢轻松聚会、可以互坑一点的桌游，以后推荐可以按这个来', 'player@example.com');

    const playerMemory = getUserMemory('player@example.com');
    const otherMemory = getUserMemory('other@example.com');

    expect(playerMemory.likedTags).toEqual(expect.objectContaining({
      朋友聚会: expect.any(Number),
      轻松休闲: expect.any(Number),
      高互动对抗: expect.any(Number),
    }));
    expect(otherMemory.likedTags).toEqual({});
  });

  it('formats long-term memory as ranking guidance, not hard constraints', () => {
    recordPreferenceFromUserTurn('我喜欢阵营推理和烧脑策略，以后可以多推荐这种', 'player@example.com');

    const prompt = getPersistentContextForPrompt('player@example.com');

    expect(prompt).toContain('长期账号偏好记忆');
    expect(prompt).toContain('阵营推理');
    expect(prompt).toContain('本轮用户明确需求永远优先');
  });
});
