import { describe, expect, it } from 'vitest';

import {
  appendSpeechText,
  collectCompletedSpeechSegments,
  collectFinalSpeechSegments,
  collectStablePreviewSpeechSegments,
  mergeSpeechSegments,
} from '../streamedTtsUtils';

describe('collectCompletedSpeechSegments', () => {
  it('waits for a full sentence before emitting the first segment', () => {
    const firstFrame = collectCompletedSpeechSegments('先说结论，', 0);
    const secondFrame = collectCompletedSpeechSegments('先说结论，四个人我更推荐《阿瓦隆》', 0);
    const thirdFrame = collectCompletedSpeechSegments('先说结论，四个人我更推荐《阿瓦隆》。理由是信息量刚好。', 0);

    expect(firstFrame.segments).toEqual([]);
    expect(secondFrame.segments).toEqual([]);
    expect(thirdFrame.segments).toEqual(['先说结论，四个人我更推荐《阿瓦隆》。', '理由是信息量刚好。']);
  });

  it('only emits preview speech after a sentence stays stable across frames', () => {
    const firstFrame = collectStablePreviewSpeechSegments(
      '先说结论，四个人先玩《机密代号》。',
      '',
      0,
    );
    const secondFrame = collectStablePreviewSpeechSegments(
      '先说结论，四个人先玩《机密代号》。如果想更欢乐，再看《只言片语》。',
      '先说结论，四个人先玩《机密代号》。',
      firstFrame.nextConsumedLength,
    );

    expect(firstFrame.segments).toEqual([]);
    expect(secondFrame.segments).toEqual(['先说结论，四个人先玩《机密代号》。']);
  });

  it('drops rewritten preview copy and flushes corrected final text', () => {
    const initialStable = collectStablePreviewSpeechSegments(
      '先说结论，四个人先玩《机密代号》。如果想更欢乐，再看《只言片语》。',
      '先说结论，四个人先玩《机密代号》。',
      0,
    );
    const finalResult = collectFinalSpeechSegments(
      '先说结论，四个人更适合《阿瓦隆》。如果想更欢乐，再看《只言片语》。',
      '先说结论，四个人先玩《机密代号》。如果想更欢乐，再看《只言片语》。',
      initialStable.nextConsumedLength,
    );

    expect(initialStable.segments).toEqual(['先说结论，四个人先玩《机密代号》。']);
    expect(finalResult.segments).toEqual([
      '先说结论，四个人更适合《阿瓦隆》。',
      '如果想更欢乐，再看《只言片语》。',
    ]);
    expect(finalResult.remainingText).toBe('');
  });

  it('keeps short excited fragments together so TTS sounds natural', () => {
    const result = mergeSpeechSegments(
      ['妥！', '4人破冰，要轻松？', '那必须得是《心灵同步》啊！'],
      '',
      { final: true },
    );

    expect(result.segments).toEqual([
      '妥！4人破冰，要轻松？那必须得是《心灵同步》啊！',
    ]);
    expect(result.carrySegment).toBe('');
  });

  it('carries short preview fragments until they become a natural utterance', () => {
    const firstPass = mergeSpeechSegments(['妥！'], '');
    const secondPass = mergeSpeechSegments(
      ['4人破冰，要轻松？', '那必须得是《心灵同步》啊！'],
      firstPass.carrySegment,
    );

    expect(firstPass.segments).toEqual([]);
    expect(firstPass.carrySegment).toBe('妥！');
    expect(secondPass.segments).toEqual([
      '妥！4人破冰，要轻松？那必须得是《心灵同步》啊！',
    ]);
    expect(secondPass.carrySegment).toBe('');
  });

  it('appends batched speech text without inserting awkward separators for Chinese', () => {
    expect(
      appendSpeechText(
        '规则简单：每回合就两个动作',
        '低冲突：大家各建各的王国',
      ),
    ).toBe('规则简单：每回合就两个动作低冲突：大家各建各的王国');
  });
});
