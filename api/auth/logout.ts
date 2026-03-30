import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
} from '../_lib/agentDocs.js';
import {
  appendSetCookie,
  clearChallengeCookie,
  clearSessionCookie,
} from '../_lib/auth.js';

export const config = {
  runtime: 'edge',
};

const LOGOUT_DOC: EndpointDoc = {
  endpoint: '/api/auth/logout',
  title: '退出当前登录态',
  description: '清除当前浏览器中的登录 session 和验证码 challenge cookie。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  capabilities: [
    '退出当前登录态',
    '同时清理短期验证码状态',
  ],
  authentication: '依赖浏览器自动携带的 httpOnly cookie。',
  statefulness: '清除登录相关 cookie。',
  exampleResponse: {
    ok: true,
  },
};

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(LOGOUT_DOC);
  }

  if (req.method === 'GET') {
    return documentationResponse(LOGOUT_DOC);
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, LOGOUT_DOC);
  }

  const headers = new Headers();
  appendSetCookie(headers, clearSessionCookie(req));
  appendSetCookie(headers, clearChallengeCookie(req));

  return jsonResponse({
    ok: true,
  }, {
    status: 200,
    headers,
  });
}
