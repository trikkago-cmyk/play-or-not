import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ttsHandler from '../tts';

describe('/api/tts agent-friendly contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TTS_PROVIDER = 'minimax';
    process.env.MINIMAX_TTS_API_KEY = 'test-minimax-key';
    process.env.MINIMAX_TTS_MODEL = 'speech-2.5-hd-preview';
    process.env.MINIMAX_TTS_VOICE_ID = 'Chinese (Mandarin)_Warm_Bestie';
    delete process.env.TTS_SERVICE_URL;
    delete process.env.COSYVOICE_TTS_SERVICE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns endpoint documentation on GET', async () => {
    const response = await ttsHandler(new Request('http://localhost/api/tts', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.endpoint).toBe('/api/tts');
    expect(payload.required_fields).toContain('text');
  });

  it('returns a structured validation error when text is missing', async () => {
    const response = await ttsHandler(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);

    const payload = await response.json();
    expect(payload.code).toBe('missing_parameter');
  });

  it('returns playable audio when MiniMax responds with hex audio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({
        base_resp: { status_code: 0, status_msg: 'success' },
        data: { audio: '000102ff' },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    )));

    const response = await ttsHandler(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: '欢迎来到今晚的桌游局。',
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('x-tts-provider')).toBe('minimax');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0, 1, 2, 255]);
  });

  it('proxies audio from a self-hosted CosyVoice service when configured', async () => {
    process.env.TTS_PROVIDER = 'cosyvoice_service';
    process.env.TTS_SERVICE_URL = 'http://127.0.0.1:8010';

    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(new Uint8Array([10, 20, 30]), {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
        },
      })
    )));

    const response = await ttsHandler(new Request('http://localhost/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: '欢迎来到今晚的桌游局。',
        instruction: '温柔一点。',
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('x-tts-provider')).toBe('cosyvoice_service');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes)).toEqual([10, 20, 30]);
  });
});
