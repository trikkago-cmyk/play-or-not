import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
  validationError,
} from './_lib/agentDocs.js';

export const config = {
  runtime: 'nodejs',
};

type NodeRequestLike = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  [Symbol.asyncIterator]?: () => AsyncIterableIterator<Uint8Array | string>;
};

type NodeResponseLike = {
  end: (chunk?: Uint8Array | Buffer | string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

const DEFAULT_TTS_SERVICE_URL = 'http://127.0.0.1:8010';
const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimaxi.com';
const DEFAULT_MINIMAX_MODEL = 'speech-2.5-hd-preview';
const DEFAULT_MINIMAX_VOICE_ID = 'Chinese (Mandarin)_Warm_Bestie';
const DEFAULT_AUDIO_FORMAT = 'mp3';
const DEFAULT_SAMPLE_RATE = 32000;
const DEFAULT_BITRATE = 128000;
const DEFAULT_SPEED = 0.96;
const DEFAULT_VOLUME = 1;
const DEFAULT_PITCH = 0;

type ParsedTtsBody = {
  text: string;
  voiceId?: string;
  speed?: number;
  emotion?: string;
  instruction?: string;
};

const TTS_DOC: EndpointDoc = {
  endpoint: '/api/tts',
  title: 'DM 语音播报接口',
  description: '将文本转换为可直接播放的音频流。当前优先支持自托管 CosyVoice 服务，也兼容 MiniMax TTS。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  requestContentType: 'application/json',
  requiredFields: ['text'],
  optionalFields: {
    voiceId: '可选，覆盖默认 voice_id。MiniMax 使用系统或克隆 voice_id；自托管服务可按自身协议解释。',
    speed: '可选，0.5 - 2 之间的语速覆盖值。',
    emotion: '可选，透传给上游服务的情感标签。',
    instruction: '可选，给 CosyVoice 类模型的语气/风格指令。',
  },
  capabilities: [
    '返回可直接播放的 audio/* 响应',
    '支持自托管 CosyVoice 服务与 MiniMax 双后端',
    '前端只调用同一个 /api/tts，后端 provider 可通过环境变量切换',
  ],
  limitations: [
    'CosyVoice provider 需要额外部署 Python 推理服务，Vercel 自身不运行大模型。',
    '如果没有配置任何上游 provider，前端会回退到浏览器原生语音。',
  ],
  notes: [
    '推荐优先配置 TTS_PROVIDER=cosyvoice_service 和 TTS_SERVICE_URL，走自托管免费链路。',
    '如果你后续录了自己的声音，可以把 prompt 音频放到 CosyVoice 服务侧，不需要再改前端。',
  ],
  authentication: '当前不对外暴露独立鉴权；由站点前端在同域下调用。',
  statefulness: '接口无状态，每次请求独立生成音频。',
  exampleRequest: {
    text: '欢迎来到今晚的桌游局，我们先看看适合几个人玩。',
    instruction: '温柔、自然、像熟悉桌游的女生朋友一样开场。',
    speed: 0.96,
  },
  exampleResponse: {
    content_type: 'audio/wav',
    bytes: '<binary audio stream>',
  },
};

function normalizeBaseUrl(rawBaseUrl?: string, fallback = DEFAULT_TTS_SERVICE_URL) {
  return (rawBaseUrl || fallback).trim().replace(/\/+$/, '');
}

function resolveProvider() {
  const explicitProvider = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (explicitProvider) {
    return explicitProvider;
  }

  if (process.env.TTS_SERVICE_URL?.trim() || process.env.COSYVOICE_TTS_SERVICE_URL?.trim()) {
    return 'cosyvoice_service';
  }

  return process.env.MINIMAX_TTS_API_KEY?.trim() ? 'minimax' : 'disabled';
}

function parseBoundedNumber(rawValue: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string' && rawValue.trim()
      ? Number(rawValue)
      : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function hexToUint8Array(hex: string) {
  const normalized = hex.trim();
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error('Invalid hex audio payload.');
  }

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function uint8ArrayToArrayBuffer(value: Uint8Array) {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  return copied.buffer;
}

async function parseTtsBody(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      errorResponse: validationError(
        TTS_DOC,
        'unsupported_content_type',
        'POST /api/tts requires application/json.',
        'Send a JSON body with a non-empty text field.',
        { received_content_type: contentType || 'none' },
        415,
      ),
    };
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return {
      errorResponse: validationError(
        TTS_DOC,
        'invalid_json',
        'Request body must be valid JSON.',
        'POST /api/tts with {"text":"欢迎来到今晚的桌游局。"}',
      ),
    };
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return {
      errorResponse: validationError(
        TTS_DOC,
        'missing_parameter',
        'Request body must include a non-empty text field.',
        'Provide text like {"text":"欢迎来到今晚的桌游局。"}',
        { required_fields: TTS_DOC.requiredFields },
      ),
    };
  }

  if (text.length > 10000) {
    return {
      errorResponse: validationError(
        TTS_DOC,
        'text_too_long',
        'Text exceeds the maximum supported length.',
        'Keep each TTS request under 10,000 characters after cleanup.',
        { max_length: 10000, received_length: text.length },
        413,
      ),
    };
  }

  // Keep explicit typing here: Vercel Edge's parser choked on `satisfies` in this file.
  const parsedBody: ParsedTtsBody = {
    text,
    voiceId: typeof body.voiceId === 'string' && body.voiceId.trim() ? body.voiceId.trim() : undefined,
    speed: typeof body.speed === 'number' ? body.speed : undefined,
    emotion: typeof body.emotion === 'string' && body.emotion.trim() ? body.emotion.trim() : undefined,
    instruction: typeof body.instruction === 'string' && body.instruction.trim() ? body.instruction.trim() : undefined,
  };

  return {
    body: parsedBody,
  };
}

function passThroughAudioResponse(response: Response, provider: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('content-type') || 'audio/wav');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-TTS-Provider', provider);

  Object.entries(extraHeaders).forEach(([key, value]) => {
    if (value) {
      headers.set(key, value);
    }
  });

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

async function proxyCosyVoiceService(body: ParsedTtsBody) {
  const baseUrl = normalizeBaseUrl(
    process.env.TTS_SERVICE_URL || process.env.COSYVOICE_TTS_SERVICE_URL,
    DEFAULT_TTS_SERVICE_URL,
  );

  const upstreamResponse = await fetch(`${baseUrl}/synthesize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: body.text,
      speed: body.speed,
      voice_id: body.voiceId,
      instruction: body.instruction,
      emotion: body.emotion,
    }),
  });

  if (!upstreamResponse.ok) {
    const upstreamPayload = await upstreamResponse.text().catch(() => '');
    return jsonResponse({
      code: 'tts_upstream_error',
      error: 'CosyVoice TTS service request failed.',
      provider: 'cosyvoice_service',
      hint: 'Check TTS_SERVICE_URL, prompt voice config, and whether the CosyVoice Python service is healthy.',
      upstream_status: upstreamResponse.status,
      upstream: upstreamPayload,
    }, {
      status: 502,
    });
  }

  const contentType = upstreamResponse.headers.get('content-type') || '';
  if (!contentType.startsWith('audio/')) {
    const upstreamPayload = await upstreamResponse.text().catch(() => '');
    return jsonResponse({
      code: 'tts_invalid_upstream_payload',
      error: 'CosyVoice service did not return playable audio.',
      provider: 'cosyvoice_service',
      upstream: upstreamPayload,
    }, {
      status: 502,
    });
  }

  return passThroughAudioResponse(upstreamResponse, 'cosyvoice_service');
}

async function proxyMiniMax(body: ParsedTtsBody) {
  const apiKey = process.env.MINIMAX_TTS_API_KEY?.trim() || '';
  if (!apiKey) {
    return jsonResponse({
      code: 'tts_unconfigured',
      error: 'MINIMAX_TTS_API_KEY is missing.',
      hint: 'Add MINIMAX_TTS_API_KEY in Vercel Environment Variables, then redeploy.',
    }, {
      status: 503,
    });
  }

  const baseUrl = normalizeBaseUrl(process.env.MINIMAX_TTS_BASE_URL, DEFAULT_MINIMAX_BASE_URL);
  const model = (process.env.MINIMAX_TTS_MODEL || DEFAULT_MINIMAX_MODEL).trim();
  const voiceId = body.voiceId || (process.env.MINIMAX_TTS_VOICE_ID || DEFAULT_MINIMAX_VOICE_ID).trim();
  const emotion = body.emotion || (process.env.MINIMAX_TTS_EMOTION || '').trim();

  const speed = parseBoundedNumber(body.speed ?? process.env.MINIMAX_TTS_SPEED, DEFAULT_SPEED, 0.5, 2);
  const volume = parseBoundedNumber(process.env.MINIMAX_TTS_VOLUME, DEFAULT_VOLUME, 0.1, 10);
  const pitch = parseBoundedNumber(process.env.MINIMAX_TTS_PITCH, DEFAULT_PITCH, -12, 12);
  const sampleRate = parseBoundedNumber(process.env.MINIMAX_TTS_SAMPLE_RATE, DEFAULT_SAMPLE_RATE, 8000, 48000);
  const bitrate = parseBoundedNumber(process.env.MINIMAX_TTS_BITRATE, DEFAULT_BITRATE, 32000, 320000);

  const requestBody = {
    model,
    text: body.text,
    stream: false,
    subtitle_enable: false,
    language_boost: 'Chinese',
    output_format: 'hex',
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: volume,
      pitch,
      ...(emotion ? { emotion } : {}),
    },
    audio_setting: {
      sample_rate: sampleRate,
      bitrate,
      format: DEFAULT_AUDIO_FORMAT,
      channel: 1,
    },
  };

  const upstreamResponse = await fetch(`${baseUrl}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const upstreamPayload = await upstreamResponse.json().catch(() => null);

  if (!upstreamResponse.ok) {
    return jsonResponse({
      code: 'tts_upstream_error',
      error: 'MiniMax TTS request failed.',
      provider: 'minimax',
      hint: 'Check MINIMAX_TTS_API_KEY, model, voice_id, and account quota.',
      upstream_status: upstreamResponse.status,
      upstream: upstreamPayload,
    }, {
      status: 502,
    });
  }

  const audioHex = typeof upstreamPayload?.data?.audio === 'string'
    ? upstreamPayload.data.audio
    : '';

  if (upstreamPayload?.base_resp?.status_code !== 0 || !audioHex) {
    return jsonResponse({
      code: 'tts_invalid_upstream_payload',
      error: 'MiniMax TTS did not return playable audio.',
      provider: 'minimax',
      upstream: upstreamPayload,
    }, {
      status: 502,
    });
  }

  const audioBytes = hexToUint8Array(audioHex);

  return new Response(audioBytes, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-TTS-Provider': 'minimax',
      'X-TTS-Voice-Id': voiceId,
    },
  });
}

async function handleFetchRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(TTS_DOC);
  }

  if (req.method === 'GET') {
    return documentationResponse(TTS_DOC);
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, TTS_DOC);
  }

  const parsed = await parseTtsBody(req);
  if (parsed.errorResponse) {
    return parsed.errorResponse;
  }

  const provider = resolveProvider();

  try {
    if (provider === 'cosyvoice_service' || provider === 'tts_service') {
      return await proxyCosyVoiceService(parsed.body);
    }

    if (provider === 'minimax') {
      return await proxyMiniMax(parsed.body);
    }

    return jsonResponse({
      code: 'tts_unconfigured',
      error: 'Server-side TTS provider is not configured.',
      hint: 'Set TTS_PROVIDER=cosyvoice_service and configure TTS_SERVICE_URL, or configure MiniMax credentials.',
    }, {
      status: 503,
    });
  } catch (error: any) {
    return jsonResponse({
      code: 'tts_internal_error',
      error: error?.message || 'TTS request failed.',
      hint: 'Retry once. If it keeps failing, verify the selected provider and its base URL.',
    }, {
      status: 500,
    });
  }
}

function isFetchRequest(value: unknown): value is Request {
  return value instanceof Request
    || (
      typeof value === 'object'
      && value !== null
      && 'headers' in value
      && typeof (value as { headers?: { get?: unknown } }).headers?.get === 'function'
      && typeof (value as { json?: unknown }).json === 'function'
    );
}

async function nodeRequestToFetchRequest(req: NodeRequestLike): Promise<Request> {
  const headers = new Headers();

  Object.entries(req.headers || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        headers.append(key, item);
      });
      return;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
    }
  });

  let body: BodyInit | undefined;
  const method = (req.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (req.body instanceof Uint8Array) {
      body = new Blob([uint8ArrayToArrayBuffer(req.body)]);
    } else if (req.body instanceof ArrayBuffer) {
      body = new Blob([req.body]);
    } else if (req.body !== undefined && req.body !== null) {
      body = JSON.stringify(req.body);
    } else if (typeof req[Symbol.asyncIterator] === 'function') {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
        chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      }
      if (chunks.length > 0) {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        chunks.forEach((chunk) => {
          merged.set(chunk, offset);
          offset += chunk.length;
        });
        body = new Blob([uint8ArrayToArrayBuffer(merged)]);
      }
    }
  }

  const host = headers.get('host') || 'localhost';
  const protocol = headers.get('x-forwarded-proto') || 'https';
  const url = new URL(req.url || '/api/tts', `${protocol}://${host}`);

  return new Request(url.toString(), {
    method,
    headers,
    body,
  });
}

async function sendFetchResponse(res: NodeResponseLike, response: Response): Promise<void> {
  res.statusCode = response.status;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  const arrayBuffer = await response.arrayBuffer();
  res.end(Buffer.from(arrayBuffer));
}

export default async function handler(req: Request | NodeRequestLike, res?: NodeResponseLike) {
  if (isFetchRequest(req)) {
    return handleFetchRequest(req);
  }

  const response = await handleFetchRequest(await nodeRequestToFetchRequest(req));

  if (res) {
    await sendFetchResponse(res, response);
    return;
  }

  return response;
}
