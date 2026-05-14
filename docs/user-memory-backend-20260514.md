# User Memory Backend - 2026-05-14

## What Changed

- Added authenticated `/api/user-data` on Vercel Functions for account-scoped user data.
- Added durable storage with provider priority: Upstash Redis first, then Vercel Blob via `BLOB_READ_WRITE_TOKEN`.
- Kept local in-memory fallback for local tests only; Vercel Preview/Production fail loudly with `user_data_store_unconfigured` if no durable provider is configured.
- Frontend now hydrates sessions and account memory from the backend first, then falls back to localStorage only when remote data is unavailable.
- Existing local sessions are seeded into the backend on first successful backend hydration when the remote account has no sessions yet.

## Stored Shape

- `sessions`: real chat sessions, including messages, mode, active game, and `DialogueAgent` snapshot.
- `currentSessionId`: last active session for the account.
- `memory`: account-level long-term preference memory.

## Vercel Env Required

- Preferred DB-style path: `UPSTASH_REDIS_REST_URL` or Vercel Marketplace `KV_REST_API_URL`
- Preferred DB-style path: `UPSTASH_REDIS_REST_TOKEN` or Vercel Marketplace `KV_REST_API_TOKEN`
- Current fallback path: `BLOB_READ_WRITE_TOKEN`

## Verification

- `npm exec -- tsc -p tsconfig.app.json --noEmit`
- `npm test`
- `npm run build`

## Honest Boundary

This is now a real backend persistence path when Upstash Redis or Vercel Blob is configured on Vercel. Blob is a durable JSON-store fallback, not a relational user-profile system with analytics tables, memory review queues, or cross-device conflict resolution.
