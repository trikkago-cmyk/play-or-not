import { describe, expect, it } from 'vitest';
import chatHandler from '../chat';

describe('/api/chat agent-friendly contract', () => {
  it('returns machine-readable endpoint documentation on GET', async () => {
    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'GET',
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('allow')).toContain('POST');

    const payload = await response.json();
    expect(payload.endpoint).toBe('/api/chat');
    expect(payload.docs_url).toBe('/developers/');
    expect(payload.openapi_url).toBe('/openapi.json');
    expect(payload.capabilities_url).toBe('/capabilities.json');
    expect(payload.recommended_tasks[0]?.id).toBe('recommend_game');
  });

  it('returns a structured validation error when messages are missing', async () => {
    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ temperature: 0.7 }),
    }));

    expect(response.status).toBe(400);

    const payload = await response.json();
    expect(payload.code).toBe('missing_parameter');
    expect(payload.error).toContain('messages');
    expect(payload.hint).toContain('Provide messages');
  });

  it('rejects unsupported task values with a structured error', async () => {
    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: 'invent_new_mode',
        messages: [{ role: 'user', content: '推荐一个桌游' }],
      }),
    }));

    expect(response.status).toBe(400);

    const payload = await response.json();
    expect(payload.code).toBe('invalid_task');
    expect(payload.capabilities_url).toBe('/capabilities.json');
  });
});
