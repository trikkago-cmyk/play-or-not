import { describe, expect, it } from 'vitest';
import ragHandler from '../rag';

describe('/api/rag agent-friendly contract', () => {
  it('returns documentation when describe=1', async () => {
    const response = await ragHandler(new Request('http://localhost/api/rag?describe=1', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.endpoint).toBe('/api/rag');
    expect(payload.allowed_methods).toContain('POST');
  });
});
