import { Redis } from '@upstash/redis';
import { get as getBlob, put as putBlob } from '@vercel/blob';

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
    const blob = await getBlob(await getUserDataBlobPath(email), {
      access: 'private',
      token: blobToken,
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return defaultUserData();
    }

    const text = await new Response(blob.stream).text();
    return sanitizeStoredUserData(JSON.parse(text));
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
    await putBlob(await getUserDataBlobPath(email), JSON.stringify(nextData), {
      access: 'private',
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
      token: blobToken,
      cacheControlMaxAge: 60,
    });
    return nextData;
  }

  localFallbackStore.set(key, nextData);
  return nextData;
}

export function resetLocalUserDataStoreForTests() {
  localFallbackStore.clear();
  redisClient = null;
}
