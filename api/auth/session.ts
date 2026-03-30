import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
} from '../_lib/agentDocs.js';
import {
  clearSessionCookie,
  appendSetCookie,
  maskEmail,
  readSessionFromRequest,
  sessionExpiresInSeconds,
} from '../_lib/auth.js';

export const config = {
  runtime: 'edge',
};

const SESSION_DOC: EndpointDoc = {
  endpoint: '/api/auth/session',
  title: '读取当前登录态',
  description: '返回当前浏览器是否已登录。GET 默认返回会话状态，GET ?describe=1 返回接口说明。',
  allowedMethods: ['GET', 'OPTIONS'],
  capabilities: [
    '读取当前浏览器的人类登录状态',
    '返回当前 session 对应的邮箱信息',
  ],
  limitations: [
    '当前 session 仅通过浏览器 cookie 维持，不是公开的 agent auth 机制。',
  ],
  authentication: '依赖浏览器自动携带的 httpOnly cookie。',
  statefulness: '读取并校验登录 session cookie。',
  exampleResponse: {
    authenticated: true,
    user: {
      email: 'luosi@example.com',
      masked_email: 'lu***@e***.com',
    },
  },
};

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(SESSION_DOC);
  }

  if (req.method !== 'GET') {
    return methodNotAllowed(req.method, SESSION_DOC);
  }

  const url = new URL(req.url);
  if (url.searchParams.get('describe') === '1') {
    return documentationResponse(SESSION_DOC);
  }

  const session = await readSessionFromRequest(req);
  if (!session) {
    const headers = new Headers();
    appendSetCookie(headers, clearSessionCookie(req));

    return jsonResponse({
      authenticated: false,
    }, {
      status: 200,
      headers,
    });
  }

  return jsonResponse({
    authenticated: true,
    user: {
      email: session.email,
      masked_email: maskEmail(session.email),
    },
    session_expires_in_seconds: sessionExpiresInSeconds(session),
  }, {
    status: 200,
  });
}
