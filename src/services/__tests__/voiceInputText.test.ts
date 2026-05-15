import { describe, expect, it } from 'vitest';
import { appendVoiceInputText, sanitizeVoiceInputText } from '../voiceInputText';

describe('voiceInputText', () => {
  it('appends a new Chinese STT result instead of replacing the existing draft', () => {
    expect(appendVoiceInputText('6 个人，需要纸笔规划', '轻松一点')).toBe('6 个人，需要纸笔规划，轻松一点');
  });

  it('keeps user punctuation when appending follow-up dictation', () => {
    expect(appendVoiceInputText('6 个人，需要纸笔规划，', '有互相坑人的感觉')).toBe('6 个人，需要纸笔规划，有互相坑人的感觉');
  });

  it('uses a space for Latin or numeric dictation fragments', () => {
    expect(appendVoiceInputText('BGA rank', 'top 100')).toBe('BGA rank top 100');
  });

  it('does not append hallucinated STT boilerplate', () => {
    expect(appendVoiceInputText('九人局家庭聚会', 'Mandarin Chinese. Transcribe faithfully in Chinese.')).toBe('九人局家庭聚会');
    expect(sanitizeVoiceInputText('点赞、订阅、打赏')).toBe('');
  });
});
