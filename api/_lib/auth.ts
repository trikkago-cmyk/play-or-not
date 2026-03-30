export interface EmailChallengePayload {
  kind: 'email_challenge';
  email: string;
  codeHash: string;
  codeSalt: string;
  issuedAt: number;
  expiresAt: number;
  cooldownUntil: number;
  attempts: number;
  maxAttempts: number;
}

export interface SessionPayload {
  kind: 'session';
  email: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface DeliveryResult {
  deliveryMode: 'resend' | 'dev_echo';
  provider: 'resend' | 'development';
  devCode?: string;
}

const AUTH_SECRET_ENV = 'AUTH_SECRET';
const CHALLENGE_COOKIE = 'wanma_email_challenge';
const SESSION_COOKIE = 'wanma_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const CHALLENGE_TTL_SECONDS = 60 * 10;
const SEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

function getRuntimeMode() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
}

function isProductionLike() {
  return getRuntimeMode() === 'production';
}

function getAuthSecret() {
  const explicitSecret = process.env[AUTH_SECRET_ENV]?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  if (isProductionLike()) {
    throw new Error(`Missing ${AUTH_SECRET_ENV}. Set a long random secret before enabling email auth in production.`);
  }

  return 'dev-insecure-auth-secret-change-me';
}

function bytesToBase64Url(bytes: Uint8Array) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64url');
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(base64Url: string) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64Url, 'base64url'));
  }

  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseCookies(headerValue: string | null) {
  const cookies = new Map<string, string>();
  if (!headerValue) {
    return cookies;
  }

  headerValue.split(/;\s*/).forEach((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    cookies.set(name, decodeURIComponent(value));
  });

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
  } = {},
) {
  const segments = [`${name}=${encodeURIComponent(value)}`];

  segments.push(`Path=${options.path || '/'}`);

  if (typeof options.maxAge === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly !== false) {
    segments.push('HttpOnly');
  }
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    segments.push('Secure');
  }

  return segments.join('; ');
}

function shouldUseSecureCookies(req: Request) {
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.includes('https');
  }

  return new URL(req.url).protocol === 'https:';
}

async function hmacSign(value: string) {
  const secret = getAuthSecret();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signatureBuffer));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }

  return mismatch === 0;
}

async function signPayload<T>(payload: T) {
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

async function readSignedPayload<T>(token: string | undefined) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await hmacSign(encodedPayload);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = parseJson<T>(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
  return payload;
}

function generateSixDigitCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 1_000_000).padStart(6, '0');
}

function generateSessionId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function maskEmail(email: string) {
  const [localPart, domain = ''] = email.split('@');
  const maskedLocal = localPart.length <= 2
    ? `${localPart[0] || '*'}*`
    : `${localPart.slice(0, 2)}***`;
  const [domainName, ...restDomain] = domain.split('.');
  const maskedDomain = domainName
    ? `${domainName[0]}***${restDomain.length ? `.${restDomain.join('.')}` : ''}`
    : '***';

  return `${maskedLocal}@${maskedDomain}`;
}

export async function createEmailChallenge(email: string) {
  const code = generateSixDigitCode();
  const codeSalt = generateSessionId();
  const issuedAt = Date.now();
  const payload: EmailChallengePayload = {
    kind: 'email_challenge',
    email,
    codeHash: await sha256(`${email}:${code}:${codeSalt}`),
    codeSalt,
    issuedAt,
    expiresAt: issuedAt + (CHALLENGE_TTL_SECONDS * 1000),
    cooldownUntil: issuedAt + (SEND_COOLDOWN_SECONDS * 1000),
    attempts: 0,
    maxAttempts: MAX_VERIFY_ATTEMPTS,
  };

  return {
    code,
    payload,
    token: await signPayload(payload),
  };
}

export async function incrementChallengeAttempts(challenge: EmailChallengePayload) {
  const nextPayload: EmailChallengePayload = {
    ...challenge,
    attempts: challenge.attempts + 1,
  };

  return {
    payload: nextPayload,
    token: await signPayload(nextPayload),
  };
}

export async function verifyChallengeCode(challenge: EmailChallengePayload, code: string) {
  const actualHash = await sha256(`${challenge.email}:${code}:${challenge.codeSalt}`);
  return timingSafeEqual(actualHash, challenge.codeHash);
}

export async function createSession(email: string) {
  const issuedAt = Date.now();
  const payload: SessionPayload = {
    kind: 'session',
    email,
    sessionId: generateSessionId(),
    issuedAt,
    expiresAt: issuedAt + (SESSION_TTL_SECONDS * 1000),
  };

  return {
    payload,
    token: await signPayload(payload),
  };
}

export async function readChallengeFromRequest(req: Request) {
  const cookies = parseCookies(req.headers.get('cookie'));
  const payload = await readSignedPayload<EmailChallengePayload>(cookies.get(CHALLENGE_COOKIE));
  if (!payload || payload.kind !== 'email_challenge') {
    return null;
  }

  return payload;
}

export async function readSessionFromRequest(req: Request) {
  const cookies = parseCookies(req.headers.get('cookie'));
  const payload = await readSignedPayload<SessionPayload>(cookies.get(SESSION_COOKIE));
  if (!payload || payload.kind !== 'session') {
    return null;
  }

  if (payload.expiresAt <= Date.now()) {
    return null;
  }

  return payload;
}

export function createChallengeCookie(req: Request, token: string) {
  return serializeCookie(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    maxAge: CHALLENGE_TTL_SECONDS,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(req),
  });
}

export function createSessionCookie(req: Request, token: string) {
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(req),
  });
}

export function clearChallengeCookie(req: Request) {
  return serializeCookie(CHALLENGE_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(req),
  });
}

export function clearSessionCookie(req: Request) {
  return serializeCookie(SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    sameSite: 'Lax',
    secure: shouldUseSecureCookies(req),
  });
}

export function appendSetCookie(headers: Headers, cookie: string) {
  headers.append('Set-Cookie', cookie);
}

export function isChallengeExpired(challenge: EmailChallengePayload) {
  return challenge.expiresAt <= Date.now();
}

export function isChallengeCoolingDown(challenge: EmailChallengePayload) {
  return challenge.cooldownUntil > Date.now();
}

export function challengeCooldownSeconds(challenge: EmailChallengePayload) {
  return Math.max(0, Math.ceil((challenge.cooldownUntil - Date.now()) / 1000));
}

export function challengeRemainingAttempts(challenge: EmailChallengePayload) {
  return Math.max(0, challenge.maxAttempts - challenge.attempts);
}

export function sessionExpiresInSeconds(session: SessionPayload) {
  return Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
}

export function challengeExpiresInSeconds(challenge: EmailChallengePayload) {
  return Math.max(0, Math.floor((challenge.expiresAt - Date.now()) / 1000));
}

export async function sendVerificationEmail(email: string, code: string): Promise<DeliveryResult> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.EMAIL_AUTH_FROM?.trim();
  const productName = process.env.EMAIL_AUTH_PRODUCT_NAME?.trim() || '玩吗';

  if (resendApiKey && fromAddress) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: `${productName} 登录验证码`,
        text: `你的${productName}登录验证码是 ${code} 。10 分钟内有效。若非本人操作，请忽略本邮件。`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend delivery failed: ${errorText || response.status}`);
    }

    return {
      deliveryMode: 'resend',
      provider: 'resend',
    };
  }

  if (!isProductionLike() || process.env.AUTH_DEV_ALLOW_INSECURE_CODE === 'true') {
    return {
      deliveryMode: 'dev_echo',
      provider: 'development',
      devCode: code,
    };
  }

  throw new Error('Email delivery is not configured. Set RESEND_API_KEY and EMAIL_AUTH_FROM for production.');
}
