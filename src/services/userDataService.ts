import type { ChatSession } from '@/types';
import type { UserPreference } from './memoryService';

export interface RemoteUserData {
  version: 1;
  sessions: ChatSession[];
  currentSessionId: string;
  memory: UserPreference | null;
  updatedAt: number;
}

export interface RemoteUserDataResponse {
  ok: boolean;
  data?: RemoteUserData;
  code?: string;
  error?: string;
  hint?: string;
  storage?: {
    configured: boolean;
    durable: boolean;
    provider: string;
    requiredEnv?: string[];
  };
}

async function parseRemoteUserDataResponse(response: Response): Promise<RemoteUserDataResponse> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      ...payload,
    };
  }

  return {
    ok: true,
    ...payload,
  };
}

export async function fetchRemoteUserData(): Promise<RemoteUserDataResponse> {
  const response = await fetch('/api/user-data', {
    method: 'GET',
    credentials: 'include',
  });

  return parseRemoteUserDataResponse(response);
}

export async function saveRemoteUserData(payload: {
  sessions: ChatSession[];
  currentSessionId: string;
  memory: UserPreference;
}): Promise<RemoteUserDataResponse> {
  const response = await fetch('/api/user-data', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  return parseRemoteUserDataResponse(response);
}
