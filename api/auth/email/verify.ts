import {
  documentationResponse,
  jsonResponse,
  methodNotAllowed,
  optionsResponse,
  type EndpointDoc,
  validationError,
} from '../../_lib/agentDocs.js';
import {
  appendSetCookie,
  challengeRemainingAttempts,
  clearChallengeCookie,
  createSession,
  createSessionCookie,
  incrementChallengeAttempts,
  isChallengeExpired,
  isValidEmail,
  maskEmail,
  readChallengeFromRequest,
  sessionExpiresInSeconds,
  verifyChallengeCode,
  createChallengeCookie,
} from '../../_lib/auth.js';

export const config = {
  runtime: 'edge',
};

const VERIFY_EMAIL_DOC: EndpointDoc = {
  endpoint: '/api/auth/email/verify',
  title: '验证邮箱验证码',
  description: '验证邮箱验证码，成功后创建登录 session cookie。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  requestContentType: 'application/json',
  requiredFields: ['email', 'code'],
  capabilities: [
    '验证邮箱验证码',
    '创建 30 天有效的人类登录 session',
  ],
  limitations: [
    '当前 challenge 仅存在于浏览器 cookie 中，跨设备不能共享。',
    '默认最多允许 5 次错误尝试，之后需要重新发送验证码。',
  ],
  authentication: '公开接口；人类登录入口使用。',
  statefulness: '成功后会通过 httpOnly cookie 写入登录 session。',
  exampleRequest: {
    email: 'luosi@example.com',
    code: '123456',
  },
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
    return optionsResponse(VERIFY_EMAIL_DOC);
  }

  if (req.method === 'GET') {
    return documentationResponse(VERIFY_EMAIL_DOC);
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, VERIFY_EMAIL_DOC);
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return validationError(
      VERIFY_EMAIL_DOC,
      'unsupported_content_type',
      'POST /api/auth/email/verify requires application/json.',
      'Send {"email":"name@example.com","code":"123456"} as JSON.',
      { received_content_type: contentType || 'none' },
      415,
    );
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';

  if (!email || !isValidEmail(email)) {
    return validationError(
      VERIFY_EMAIL_DOC,
      'invalid_email',
      'A valid email address is required.',
      'Provide the same email address used when requesting the code.',
    );
  }

  if (!/^\d{6}$/.test(code)) {
    return validationError(
      VERIFY_EMAIL_DOC,
      'invalid_code_format',
      'Verification code must be 6 digits.',
      'Provide the 6-digit code from the email.',
    );
  }

  const challenge = await readChallengeFromRequest(req);
  if (!challenge) {
    return validationError(
      VERIFY_EMAIL_DOC,
      'missing_challenge',
      'No active verification challenge was found.',
      'Request a new code with POST /api/auth/email/send and try again.',
    );
  }

  if (challenge.email !== email) {
    return validationError(
      VERIFY_EMAIL_DOC,
      'email_mismatch',
      'The email does not match the active verification challenge.',
      'Use the same email address that received the verification code.',
    );
  }

  if (isChallengeExpired(challenge)) {
    const headers = new Headers();
    appendSetCookie(headers, clearChallengeCookie(req));

    return jsonResponse({
      error: 'The verification code has expired.',
      code: 'challenge_expired',
      hint: 'Request a new code and try again.',
    }, {
      status: 410,
      headers,
    });
  }

  const isValidCode = await verifyChallengeCode(challenge, code);
  if (!isValidCode) {
    const nextChallenge = await incrementChallengeAttempts(challenge);
    const headers = new Headers();

    if (nextChallenge.payload.attempts >= nextChallenge.payload.maxAttempts) {
      appendSetCookie(headers, clearChallengeCookie(req));
    } else {
      appendSetCookie(headers, createChallengeCookie(req, nextChallenge.token));
    }

    return jsonResponse({
      error: 'Verification code is incorrect.',
      code: 'invalid_code',
      remaining_attempts: Math.max(0, challengeRemainingAttempts(nextChallenge.payload)),
      hint: nextChallenge.payload.attempts >= nextChallenge.payload.maxAttempts
        ? 'Too many failed attempts. Request a new verification code.'
        : 'Check the latest email code and try again.',
    }, {
      status: 400,
      headers,
    });
  }

  const session = await createSession(email);
  const headers = new Headers();
  appendSetCookie(headers, createSessionCookie(req, session.token));
  appendSetCookie(headers, clearChallengeCookie(req));

  return jsonResponse({
    authenticated: true,
    user: {
      email,
      masked_email: maskEmail(email),
    },
    session_expires_in_seconds: sessionExpiresInSeconds(session.payload),
  }, {
    status: 200,
    headers,
  });
}
