import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sendHandler from '../auth/email/send';
import verifyHandler from '../auth/email/verify';
import sessionHandler from '../auth/session';
import logoutHandler from '../auth/logout';

function extractCookie(headerValue: string | null, cookieName: string) {
  if (!headerValue) {
    return '';
  }

  const match = headerValue.match(new RegExp(`${cookieName}=[^;,]+`));
  return match?.[0] || '';
}

describe('/api/auth email flow', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-auth-secret';
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_AUTH_FROM;
    delete process.env.AUTH_DEV_ALLOW_INSECURE_CODE;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a dev fallback code and sets challenge cookie', async () => {
    const response = await sendHandler(new Request('http://localhost/api/auth/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'luosi@example.com' }),
    }));

    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.delivery_mode).toBe('dev_echo');
    expect(payload.dev_code).toMatch(/^\d{6}$/);
    expect(extractCookie(response.headers.get('set-cookie'), 'wanma_email_challenge')).toContain('wanma_email_challenge=');
  });

  it('completes verify -> session -> logout', async () => {
    const sendResponse = await sendHandler(new Request('http://localhost/api/auth/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'luosi@example.com' }),
    }));

    const sendPayload = await sendResponse.json();
    const challengeCookie = extractCookie(sendResponse.headers.get('set-cookie'), 'wanma_email_challenge');
    expect(challengeCookie).toBeTruthy();

    const verifyResponse = await verifyHandler(new Request('http://localhost/api/auth/email/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: challengeCookie || '',
      },
      body: JSON.stringify({
        email: 'luosi@example.com',
        code: sendPayload.dev_code,
      }),
    }));

    expect(verifyResponse.status).toBe(200);
    const verifyPayload = await verifyResponse.json();
    expect(verifyPayload.authenticated).toBe(true);

    const verifySetCookie = verifyResponse.headers.get('set-cookie') || '';
    const sessionCookie = extractCookie(verifySetCookie, 'wanma_session');
    expect(sessionCookie).toContain('wanma_session=');

    const sessionResponse = await sessionHandler(new Request('http://localhost/api/auth/session', {
      method: 'GET',
      headers: {
        cookie: sessionCookie,
      },
    }));

    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json();
    expect(sessionPayload.authenticated).toBe(true);
    expect(sessionPayload.user.email).toBe('luosi@example.com');

    const logoutResponse = await logoutHandler(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: sessionCookie,
      },
    }));

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get('set-cookie')).toContain('wanma_session=');
  });

  it('returns a specific setup error when AUTH_SECRET is missing in production', async () => {
    delete process.env.AUTH_SECRET;
    process.env.NODE_ENV = 'production';

    const response = await sendHandler(new Request('https://play-or-not-dm.vercel.app/api/auth/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'luosi@example.com' }),
    }));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe('auth_not_configured');
  });

  it('returns a specific delivery error when email provider is missing in production', async () => {
    process.env.AUTH_SECRET = 'test-auth-secret';
    process.env.NODE_ENV = 'production';

    const response = await sendHandler(new Request('https://play-or-not-dm.vercel.app/api/auth/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'luosi@example.com' }),
    }));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe('email_delivery_unconfigured');
  });

  it('returns a specific delivery error when resend domain is not verified', async () => {
    process.env.AUTH_SECRET = 'test-auth-secret';
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_AUTH_FROM = '玩吗 <noreply@auth.play-or-not-dm.online>';

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        statusCode: 403,
        message: 'The auth.play-or-not-dm.online domain is not verified.',
        name: 'validation_error',
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )));

    const response = await sendHandler(new Request('https://play-or-not-dm.vercel.app/api/auth/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'luosi@example.com' }),
    }));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.code).toBe('email_domain_unverified');
  });
});
