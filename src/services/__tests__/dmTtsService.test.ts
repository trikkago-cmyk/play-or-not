import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSpeakableMessage,
  getDmTtsEnabled,
  hasDmTtsPrimedPlayback,
  pickBestDmVoice,
  primeDmTtsPlayback,
  resetDmTtsStateForTests,
  setDmTtsEnabled,
  speakAsDm,
} from '../dmTtsService';

class MockSpeechSynthesisUtterance {
  text: string;
  voice?: SpeechSynthesisVoice;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;

  constructor(text: string) {
    this.text = text;
  }
}

function createVoice(name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice {
  return {
    name,
    lang,
    default: false,
    localService: true,
    voiceURI: `${name}-${lang}`,
    ...extra,
  } as SpeechSynthesisVoice;
}

describe('dmTtsService', () => {
  const cancelMock = vi.fn();
  const speakMock = vi.fn();
  const getVoicesMock = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    resetDmTtsStateForTests();
    cancelMock.mockReset();
    speakMock.mockReset();
    getVoicesMock.mockReset();
    fetchMock.mockReset();

    speakMock.mockImplementation((utterance?: MockSpeechSynthesisUtterance) => {
      queueMicrotask(() => utterance?.onstart?.());
    });

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'tts_unconfigured' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    });

    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: undefined,
    });

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: cancelMock,
        speak: speakMock,
        getVoices: getVoicesMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
  });

  it('builds a speakable message without markdown noise or reference appendix', () => {
    const speakable = buildSpeakableMessage(
      '**不能这么做。** [证据1]\n\n1. 先弃牌\n2. 再摸牌\n\n**参考依据**\n- [证据1] UNO / 常见问题：示例',
    );

    expect(speakable).toBe('不能这么做。先弃牌，再摸牌');
  });

  it('prefers a warm female Chinese voice for DM playback', () => {
    const femaleVoice = createVoice('Microsoft Xiaoxiao Online (Natural)', 'zh-CN');
    const maleVoice = createVoice('Microsoft Yunxi Online (Natural)', 'zh-CN');
    const englishVoice = createVoice('Google US English', 'en-US');

    const picked = pickBestDmVoice([englishVoice, maleVoice, femaleVoice]);

    expect(picked?.name).toContain('Xiaoxiao');
  });

  it('persists the toggle and stops playback when TTS is disabled', () => {
    expect(getDmTtsEnabled()).toBe(true);

    setDmTtsEnabled(false);

    expect(getDmTtsEnabled()).toBe(false);
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to browser speech when server-side TTS is unavailable', async () => {
    const femaleVoice = createVoice('Microsoft Xiaoxiao Online (Natural)', 'zh-CN');
    const maleVoice = createVoice('Microsoft Yunxi Online (Natural)', 'zh-CN');
    getVoicesMock.mockReturnValue([maleVoice, femaleVoice]);

    const didSpeak = await speakAsDm('**欢迎来到桌游局。**\n\n**参考依据**\n- [证据1] 示例');

    expect(didSpeak).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalled();
    expect(speakMock).toHaveBeenCalledTimes(1);

    const utterance = speakMock.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.text).toBe('欢迎来到桌游局。');
    expect(utterance.voice?.name).toContain('Xiaoxiao');
    expect(utterance.lang).toBe('zh-CN');
  });

  it('plays server-generated audio when /api/tts returns an audio stream', async () => {
    const audioPlayMock = vi.fn(function (this: { onended?: () => void }) {
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    });
    const audioPauseMock = vi.fn();

    class MockAudio {
      src: string;
      volume = 1;
      preload = 'auto';
      currentTime = 0;
      onended?: () => void;
      onerror?: () => void;

      constructor(src = '') {
        this.src = src;
      }

      play() {
        return audioPlayMock.call(this);
      }

      pause() {
        audioPauseMock();
      }
    }

    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    }));

    Object.defineProperty(window, 'Audio', {
      configurable: true,
      value: MockAudio,
    });

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:dm-tts'),
    });

    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    const didSpeak = await speakAsDm('欢迎来到桌游局。');

    expect(didSpeak).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audioPlayMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(0);
  });

  it('queues speech on gesture-restricted browsers until primed by a user gesture', async () => {
    const femaleVoice = createVoice('Microsoft Xiaoxiao Online (Natural)', 'zh-CN');
    getVoicesMock.mockReturnValue([femaleVoice]);

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });

    const firstAttempt = await speakAsDm('欢迎来到桌游局。');

    expect(firstAttempt).toBe(false);
    expect(hasDmTtsPrimedPlayback()).toBe(false);
    expect(speakMock).toHaveBeenCalledTimes(0);

    const didPrime = await primeDmTtsPlayback();

    expect(didPrime).toBe(true);
    expect(hasDmTtsPrimedPlayback()).toBe(true);
    await vi.waitFor(() => {
      expect(speakMock).toHaveBeenCalledTimes(2);
    });

    const replayUtterance = speakMock.mock.calls[1][0] as MockSpeechSynthesisUtterance;
    expect(replayUtterance.text).toBe('欢迎来到桌游局。');
  });
});
