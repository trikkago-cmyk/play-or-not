import { describe, expect, it } from 'vitest';
import sttHandler from '../stt';

describe('/api/stt agent-friendly contract', () => {
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
});
