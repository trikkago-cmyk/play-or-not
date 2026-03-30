export interface AuthSession {
  authenticated: boolean;
  user?: {
    email: string;
    masked_email?: string;
  };
  session_expires_in_seconds?: number;
}

export interface SendEmailCodeResult {
  ok: boolean;
  masked_email: string;
  delivery_mode: 'resend' | 'dev_echo';
  provider: 'resend' | 'development';
  cooldown_seconds: number;
  expires_in_seconds: number;
  dev_code?: string;
}

export interface VerifyEmailCodeResult {
  authenticated: boolean;
  user: {
    email: string;
    masked_email?: string;
  };
  session_expires_in_seconds?: number;
}

export class AuthRequestError extends Error {
  code?: string;
  hint?: string;
  status: number;

  constructor(message: string, options: { code?: string; hint?: string; status: number }) {
    super(message);
    this.name = 'AuthRequestError';
    this.code = options.code;
    this.hint = options.hint;
    this.status = options.status;
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function unwrapResponse<T>(response: Response): Promise<T> {
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new AuthRequestError(
      payload?.error || payload?.hint || '请求失败，请稍后重试',
      {
        code: payload?.code,
        hint: payload?.hint,
        status: response.status,
      },
    );
  }

  return payload as T;
}

export async function getAuthSession() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'same-origin',
  });

  return unwrapResponse<AuthSession>(response);
}

export async function sendEmailCode(email: string) {
  const response = await fetch('/api/auth/email/send', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  return unwrapResponse<SendEmailCodeResult>(response);
}

export async function verifyEmailCode(email: string, code: string) {
  const response = await fetch('/api/auth/email/verify', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, code }),
  });

  return unwrapResponse<VerifyEmailCodeResult>(response);
}

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });

  return unwrapResponse<{ ok: boolean }>(response);
}
