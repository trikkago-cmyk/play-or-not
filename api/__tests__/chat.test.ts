import { afterEach, describe, expect, it, vi } from 'vitest';
import chatHandler from '../chat';

describe('/api/chat agent-friendly contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('maps Ark Responses API payloads back into chat-completions shape', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/responses');

      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.model).toBe('deepseek-v3-2-251201');
      expect(body.input[0]?.role).toBe('system');
      expect(body.input[0]?.content?.[0]?.text).toContain('DM 洛思');
      expect(body.input[1]).toEqual({
        role: 'user',
        content: [{ type: 'input_text', text: '推荐一个适合 4 人聚会的桌游' }],
      });

      return new Response(JSON.stringify({
        id: 'resp_123',
        object: 'response',
        model: 'deepseek-v3-2-251201',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '可以先试试《机密代号》，四个人开局很顺。',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 21,
          output_tokens: 14,
          total_tokens: 35,
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v3-2-251201',
        messages: [{ role: 'user', content: '推荐一个适合 4 人聚会的桌游' }],
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.choices[0]?.message?.content).toBe('可以先试试《机密代号》，四个人开局很顺。');
    expect(payload.model).toBe('deepseek-v3-2-251201');
    expect(payload.response_id).toBe('resp_123');
  });

  it('passes through Ark Responses SSE streams when stream=true', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.stream).toBe(true);
      expect(body.input[0]?.role).toBe('system');
      expect(body.input[0]?.content?.[0]?.text).toContain('不要自称 DeepSeek');

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"delta":"你好"}\n\n'));
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v3-2-251201',
        stream: true,
        messages: [{ role: 'user', content: '你好' }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-llm-upstream-format')).toBe('ark_responses');
    await expect(response.text()).resolves.toContain('response.output_text.delta');
  });

  it('passes through sanitized Ark web_search tools for Responses calls', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/responses');

      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.tools).toEqual([{ type: 'web_search', max_keyword: 5 }]);

      return new Response(JSON.stringify({
        id: 'resp_tools',
        object: 'response',
        model: 'deepseek-v3-2-251201',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '查到了。' }],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v3-2-251201',
        messages: [{ role: 'user', content: '查一下这个规则' }],
        tools: [
          { type: 'web_search', max_keyword: 99 },
          { type: 'unsupported_tool' },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.choices[0]?.message?.content).toBe('查到了。');
  });

  it('defaults plain text chat to DeepSeek-V3.2 with the DM system prompt', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/responses');

      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.model).toBe('deepseek-v3-2-251201');
      expect(body.input[0]?.role).toBe('system');
      expect(body.input[0]?.content?.[0]?.text).toContain('DM 洛思');
      expect(body.input[0]?.content?.[0]?.text).toContain('不要自称 DeepSeek');
      expect(body.input[1]).toEqual({
        role: 'user',
        content: [{ type: 'input_text', text: '你好，洛思' }],
      });

      return new Response(JSON.stringify({
        id: 'resp_123',
        object: 'response',
        model: 'deepseek-v3-2-251201',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '在呢。',
              },
            ],
          },
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: '你好，洛思' }],
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.model).toBe('deepseek-v3-2-251201');
    expect(payload.choices[0]?.message?.content).toBe('在呢。');
  });

  it('does not duplicate a caller-provided system prompt', async () => {
    const upstreamFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.input.filter((item: any) => item.role === 'system')).toHaveLength(1);
      expect(body.input[0]?.content?.[0]?.text).toBe('自定义系统提示');

      return new Response(JSON.stringify({
        id: 'resp_456',
        object: 'response',
        model: 'deepseek-v3-2-251201',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: '收到。',
              },
            ],
          },
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '自定义系统提示' },
          { role: 'user', content: '你好' },
        ],
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.choices[0]?.message?.content).toBe('收到。');
  });

  it('still supports explicit chat-completions models with the DM system prompt', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');

      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.model).toBe('doubao-1-5-pro-32k-250115');
      expect(body.messages[0]?.role).toBe('system');
      expect(body.messages[0]?.content).toContain('DM 洛思');
      expect(body.messages[1]).toEqual({ role: 'user', content: '你好，洛思' });

      return new Response(JSON.stringify({
        id: 'chatcmpl_123',
        object: 'chat.completion',
        model: 'doubao-1-5-pro-32k-250115',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '在呢。',
            },
            finish_reason: 'stop',
          },
        ],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    });

    vi.stubGlobal('fetch', upstreamFetch);

    const response = await chatHandler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'doubao-1-5-pro-32k-250115',
        messages: [{ role: 'user', content: '你好，洛思' }],
      }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.model).toBe('doubao-1-5-pro-32k-250115');
    expect(payload.choices[0]?.message?.content).toBe('在呢。');
  });
});
