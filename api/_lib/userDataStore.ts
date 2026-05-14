import { Redis } from '@upstash/redis';

export interface StoredUserData {
  version: 1;
  sessions: unknown[];
  currentSessionId: string;
  memory: unknown;
  updatedAt: number;
}

export interface UserDataStoreStatus {
  configured: boolean;
  durable: boolean;
  provider: 'upstash_redis' | 'vercel_blob' | 'local_memory';
  requiredEnv: string[];
}

export class UserDataStoreNotConfiguredError extends Error {
  constructor() {
    super('User data store is not configured.');
    this.name = 'UserDataStoreNotConfiguredError';
  }
}

const localFallbackStore = new Map<string, StoredUserData>();

let redisClient: Redis | null = null;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isVercelRuntime() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function getRedisCredentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

function getBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || null;
}

function getRedisClient() {
  const credentials = getRedisCredentials();
  if (!credentials) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(credentials);
  }

  return redisClient;
}

function getStorageProvider() {
  if (getRedisCredentials()) {
    return 'upstash_redis' as const;
  }
  if (getBlobToken()) {
    return 'vercel_blob' as const;
  }
  return 'local_memory' as const;
}

export function getUserDataStoreStatus(): UserDataStoreStatus {
  const provider = getStorageProvider();
  const configured = provider !== 'local_memory';

  return {
    configured,
    durable: configured,
    provider,
    requiredEnv: [
      'UPSTASH_REDIS_REST_URL or KV_REST_API_URL',
      'UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN',
      'or BLOB_READ_WRITE_TOKEN',
    ],
  };
}

function defaultUserData(): StoredUserData {
  return {
    version: 1,
    sessions: [],
    currentSessionId: '',
    memory: null,
    updatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeStoredUserData(value: unknown): StoredUserData {
  if (!isRecord(value)) {
    return defaultUserData();
  }

  return {
    version: 1,
    sessions: Array.isArray(value.sessions) ? value.sessions.slice(0, 80) : [],
    currentSessionId: typeof value.currentSessionId === 'string' ? value.currentSessionId : '',
    memory: typeof value.memory === 'undefined' ? null : value.memory,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

async function hashEmailForKey(email: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeEmail(email)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getUserDataKey(email: string) {
  return `play-or-not:user-data:v1:${await hashEmailForKey(email)}`;
}

async function getUserDataBlobPath(email: string) {
  return `play-or-not/user-data/v1/${await hashEmailForKey(email)}.json`;
}

function getBlobStoreId(token: string) {
  const [, , , storeId = ''] = token.split('_');
  return storeId;
}

function getBlobReadUrl(pathname: string, token: string) {
  const storeId = getBlobStoreId(token);
  if (!storeId) {
    throw new Error('Invalid BLOB_READ_WRITE_TOKEN: unable to extract store id.');
  }

  const encodedPathname = pathname.split('/').map(encodeURIComponent).join('/');
  return `https://${storeId}.private.blob.vercel-storage.com/${encodedPathname}`;
}

async function readBlobUserData(pathname: string, token: string) {
  const url = new URL(getBlobReadUrl(pathname, token));
  url.searchParams.set('cache', '0');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Vercel Blob read failed: ${response.status}`);
  }

  return response.json();
}

async function writeBlobUserData(pathname: string, data: StoredUserData, token: string) {
  const requestId = `${getBlobStoreId(token)}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const params = new URLSearchParams({ pathname });
  const response = await fetch(`https://vercel.com/api/blob/?${params.toString()}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-version': '12',
      'x-api-blob-request-id': requestId,
      'x-api-blob-request-attempt': '0',
      'x-vercel-blob-access': 'private',
      'x-allow-overwrite': '1',
      'x-content-type': 'application/json; charset=utf-8',
      'x-cache-control-max-age': '60',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vercel Blob write failed: ${response.status}${errorText ? ` ${errorText}` : ''}`);
  }
}

function assertStoreAvailable() {
  if (getStorageProvider() === 'local_memory' && isVercelRuntime()) {
    throw new UserDataStoreNotConfiguredError();
  }
}

export async function readUserData(email: string): Promise<StoredUserData> {
  assertStoreAvailable();

  const redis = getRedisClient();
  const key = await getUserDataKey(email);

  if (redis) {
    const data = await redis.get<StoredUserData>(key);
    return sanitizeStoredUserData(data);
  }

  const blobToken = getBlobToken();
  if (blobToken) {
    return sanitizeStoredUserData(await readBlobUserData(await getUserDataBlobPath(email), blobToken));
  }

  return sanitizeStoredUserData(localFallbackStore.get(key));
}

export async function writeUserData(email: string, data: Partial<StoredUserData>): Promise<StoredUserData> {
  assertStoreAvailable();

  const key = await getUserDataKey(email);
  const nextData = sanitizeStoredUserData({
    ...defaultUserData(),
    ...data,
    updatedAt: Date.now(),
  });
  const redis = getRedisClient();

  if (redis) {
    await redis.set(key, nextData);
    return nextData;
  }

  const blobToken = getBlobToken();
  if (blobToken) {
    await writeBlobUserData(await getUserDataBlobPath(email), nextData, blobToken);
    return nextData;
  }

  localFallbackStore.set(key, nextData);
  return nextData;
}

export function resetLocalUserDataStoreForTests() {
  localFallbackStore.clear();
  redisClient = null;
}
