import { afterEach, describe, expect, it, vi } from 'vitest';
import sttHandler from '../stt';

describe('/api/stt agent-friendly contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns endpoint documentation on GET', async () => {
    const response = await sttHandler(new Request('http://localhost/api/stt', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.endpoint).toBe('/api/stt');
    expect(payload.required_fields).toContain('file');
  });

  it('returns a structured content-type error for non-multipart POST', async () => {
    const response = await sttHandler(new Request('http://localhost/api/stt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(415);

    const payload = await response.json();
    expect(payload.code).toBe('unsupported_content_type');
  });

  it('proxies preview STT requests to production when preview env is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');

    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({
        text: '推荐一个适合 4 人破冰的桌游',
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const formData = new FormData();
    formData.append('file', new File(['audio'], 'sample.webm', { type: 'audio/webm' }));

    const response = await sttHandler(new Request('https://play-or-not-jweuhsq9n-trikkagos-projects.vercel.app/api/stt', {
      method: 'POST',
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-stt-fallback')).toBe('production-proxy');
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    const [upstreamUrl, upstreamInit] = upstreamFetch.mock.calls[0];
    expect(String(upstreamUrl)).toBe('https://play-or-not-dm.vercel.app/api/stt');
    expect(upstreamInit?.method).toBe('POST');
    expect(upstreamInit?.headers).toMatchObject({
      'x-stt-proxy-fallback': '1',
    });

    const payload = await response.json();
    expect(payload.text).toContain('4 人破冰');
  });
});
