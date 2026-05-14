import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
  validationError,
} from './_lib/agentDocs.js';
import { readSessionFromRequest } from './_lib/auth.js';
import {
  getUserDataStoreStatus,
  readUserData,
  UserDataStoreNotConfiguredError,
  writeUserData,
} from './_lib/userDataStore.js';

export const config = {
  runtime: 'edge',
};

const USER_DATA_DOC: EndpointDoc = {
  endpoint: '/api/user-data',
  title: '用户会话与长期记忆存储接口',
  description: '按登录账号读取和写入桌游 DM 的历史会话、当前会话 ID、长期偏好记忆。',
  allowedMethods: ['GET', 'PUT', 'OPTIONS'],
  requestContentType: 'application/json',
  requiredFields: ['sessions', 'currentSessionId', 'memory'],
  capabilities: [
    '读取当前登录用户的真实历史会话',
    '保存单会话短期记忆快照',
    '保存账号维度长期偏好记忆',
  ],
  limitations: [
    '优先使用 Upstash Redis；未配置 Redis 时可使用 Vercel Blob 作为持久 JSON 存储。',
    '本接口只服务当前登录用户，不提供跨账号读取能力。',
  ],
  authentication: '依赖浏览器自动携带的 httpOnly wanma_session cookie。',
  statefulness: 'Vercel 环境下通过 Upstash Redis 或 Vercel Blob 持久化；本地测试环境可使用内存 fallback。',
  exampleRequest: {
    sessions: [],
    currentSessionId: '',
    memory: {
      likedTags: {},
      dislikedTags: {},
      likedGames: [],
      dislikedGames: [],
    },
  },
  exampleResponse: {
    ok: true,
    data: {
      sessions: [],
      currentSessionId: '',
      memory: null,
    },
  },
};

function unauthorized() {
  return jsonResponse({
    ok: false,
    code: 'unauthorized',
    error: 'Please sign in before reading or writing user data.',
  }, {
    status: 401,
  });
}

function storageNotConfigured() {
  const status = getUserDataStoreStatus();

  return jsonResponse({
    ok: false,
    code: 'user_data_store_unconfigured',
    error: 'User data backend is not configured for this Vercel environment.',
    hint: `Connect Upstash Redis or Vercel Blob in Vercel and expose ${status.requiredEnv.join(' and ')} to Preview/Production.`,
    storage: status,
  }, {
    status: 503,
  });
}

async function readJsonBody(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  return req.json().catch(() => null);
}

function sanitizeRequestPayload(body: unknown) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  return {
    sessions: Array.isArray(record.sessions) ? record.sessions : [],
    currentSessionId: typeof record.currentSessionId === 'string' ? record.currentSessionId : '',
    memory: typeof record.memory === 'undefined' ? null : record.memory,
  };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(USER_DATA_DOC);
  }

  if (req.method === 'GET' && new URL(req.url).searchParams.get('describe') === '1') {
    return documentationResponse(USER_DATA_DOC);
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    return methodNotAllowed(req.method, USER_DATA_DOC);
  }

  const session = await readSessionFromRequest(req);
  if (!session) {
    return unauthorized();
  }

  try {
    if (req.method === 'GET') {
      const data = await readUserData(session.email);
      return jsonResponse({
        ok: true,
        data,
        storage: getUserDataStoreStatus(),
      });
    }

    const body = await readJsonBody(req);
    const payload = sanitizeRequestPayload(body);
    if (!payload) {
      return validationError(
        USER_DATA_DOC,
        'invalid_user_data_payload',
        'PUT /api/user-data requires JSON with sessions, currentSessionId, and memory.',
        'Send { "sessions": [], "currentSessionId": "", "memory": {} }.',
      );
    }

    const data = await writeUserData(session.email, payload);
    return jsonResponse({
      ok: true,
      data,
      storage: getUserDataStoreStatus(),
    });
  } catch (error) {
    if (error instanceof UserDataStoreNotConfiguredError) {
      return storageNotConfigured();
    }

    return jsonResponse({
      ok: false,
      code: 'user_data_store_error',
      error: error instanceof Error ? error.message : 'Unknown user data store error.',
    }, {
      status: 500,
    });
  }
}
