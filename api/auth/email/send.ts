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
  challengeCooldownSeconds,
  challengeExpiresInSeconds,
  createChallengeCookie,
  createEmailChallenge,
  isChallengeCoolingDown,
  isChallengeExpired,
  isValidEmail,
  maskEmail,
  readChallengeFromRequest,
  sendVerificationEmail,
} from '../../_lib/auth.js';

export const config = {
  runtime: 'edge',
};

const SEND_EMAIL_DOC: EndpointDoc = {
  endpoint: '/api/auth/email/send',
  title: '发送邮箱验证码',
  description: '向指定邮箱发送 6 位登录验证码，并下发短期 challenge cookie。',
  allowedMethods: ['GET', 'POST', 'OPTIONS'],
  requestContentType: 'application/json',
  requiredFields: ['email'],
  optionalFields: {
    purpose: '可选，当前仅登录验证码场景使用。',
  },
  capabilities: [
    '发送登录验证码到邮箱',
    '为后续 verify 接口准备短期 challenge 状态',
  ],
  limitations: [
    '默认 60 秒冷却，验证码 10 分钟有效。',
    '若未配置邮件服务，在开发环境会回退为 dev_echo 并在响应中返回验证码。',
  ],
  authentication: '公开接口；人类登录入口使用。',
  statefulness: '接口会通过 httpOnly cookie 写入短期验证码 challenge。',
  exampleRequest: {
    email: 'luosi@example.com',
  },
  exampleResponse: {
    ok: true,
    masked_email: 'lu***@e***.com',
    delivery_mode: 'resend',
    cooldown_seconds: 60,
    expires_in_seconds: 600,
  },
};

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return optionsResponse(SEND_EMAIL_DOC);
  }

  if (req.method === 'GET') {
    return documentationResponse(SEND_EMAIL_DOC);
  }

  if (req.method !== 'POST') {
    return methodNotAllowed(req.method, SEND_EMAIL_DOC);
  }

  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return validationError(
      SEND_EMAIL_DOC,
      'unsupported_content_type',
      'POST /api/auth/email/send requires application/json.',
      'Send {"email":"name@example.com"} as JSON.',
      { received_content_type: contentType || 'none' },
      415,
    );
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email || !isValidEmail(email)) {
    return validationError(
      SEND_EMAIL_DOC,
      'invalid_email',
      'A valid email address is required.',
      'Provide an email like luosi@example.com.',
    );
  }

  const existingChallenge = await readChallengeFromRequest(req);
  if (
    existingChallenge &&
    existingChallenge.email === email &&
    !isChallengeExpired(existingChallenge) &&
    isChallengeCoolingDown(existingChallenge)
  ) {
    return validationError(
      SEND_EMAIL_DOC,
      'cooldown_active',
      'A verification code was sent recently. Please wait before requesting another one.',
      'Reuse the current code or wait for the cooldown to finish.',
      {
        cooldown_seconds: challengeCooldownSeconds(existingChallenge),
      },
      429,
    );
  }

  try {
    const challenge = await createEmailChallenge(email);
    const delivery = await sendVerificationEmail(email, challenge.code);
    const headers = new Headers();
    appendSetCookie(headers, createChallengeCookie(req, challenge.token));

    return jsonResponse({
      ok: true,
      masked_email: maskEmail(email),
      delivery_mode: delivery.deliveryMode,
      provider: delivery.provider,
      cooldown_seconds: 60,
      expires_in_seconds: challengeExpiresInSeconds(challenge.payload),
      dev_code: delivery.devCode,
    }, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Failed to deliver verification email.';
    const isMissingAuthSecret = errorMessage.includes('Missing AUTH_SECRET');
    const isEmailProviderMissing = errorMessage.includes('Email delivery is not configured');
    const isEmailDomainUnverified = errorMessage.includes('domain is not verified');

    return jsonResponse({
      error: isMissingAuthSecret
        ? '当前登录服务尚未完成初始化，请稍后再试。'
        : isEmailDomainUnverified
          ? '登录邮件域名还在验证中，请稍后再试。'
        : isEmailProviderMissing
          ? '当前测试站的邮箱发信服务还没配置完成。'
          : errorMessage,
      code: isMissingAuthSecret
        ? 'auth_not_configured'
        : isEmailDomainUnverified
          ? 'email_domain_unverified'
        : isEmailProviderMissing
          ? 'email_delivery_unconfigured'
          : 'email_delivery_failed',
      hint: isMissingAuthSecret
        ? '部署平台需要先配置 AUTH_SECRET。'
        : isEmailDomainUnverified
          ? '请先在 Resend 中完成 auth.play-or-not-dm.online 的域名验证。'
        : isEmailProviderMissing
          ? '需要补充 RESEND_API_KEY 和 EMAIL_AUTH_FROM。'
          : '请稍后重试，若持续失败请检查邮箱服务配置。',
    }, {
      status: 503,
    });
  }
}
