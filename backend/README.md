# StreetSmart backend (independent from Base44)

Owned Node.js API service with PostgreSQL persistence, configurable IdP auth,
RBAC, rate limiting, request validation, durable audit logging, and a durable
background job queue.

## Endpoints

| Method | Path                    | Auth required | Notes                                     |
|--------|-------------------------|:-------------:|-------------------------------------------|
| POST   | `/api/auth/login`       | —             | Dev-mode email login or OIDC token verify |
| GET    | `/api/tasks`            | ✓             | Lists tasks for the authenticated user    |
| POST   | `/api/tasks`            | ✓             | Creates a task                            |
| GET    | `/api/admin/tasks`      | admin         | Lists tasks across all owners             |
| POST   | `/api/uploads/presign`  | ✓             | Returns S3-compatible presigned PUT URL   |
| POST   | `/api/webhooks/stripe`  | —             | Verifies Stripe signature and dispatches  |

## Local development (without Docker)

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

If `DATABASE_URL` is not set the server falls back to in-memory storage
(tasks are lost on restart). This is fine for frontend development.

## Local development (with Docker Compose)

```bash
# From the repository root:
docker compose up
```

This starts PostgreSQL, the backend on port 4000, and the Vite dev server
on port 5173 with hot-reload.

## Environment variables

See `.env.example` for the full list with descriptions.

Required in production:
- `JWT_SECRET` — ≥ 32 random bytes, base64-encoded
- `STRIPE_WEBHOOK_SECRET`
- `DATABASE_URL`
- `AUTH_MODE=oidc`
- `AUTH_OIDC_ISSUER`
- `AUTH_OIDC_AUDIENCE`
- `FILE_BUCKET_BASE_URL`
- `FILE_BUCKET_NAME`
- `FILE_BUCKET_REGION`
- AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional session token)
- `ALLOWED_ORIGIN` — restrict CORS to your frontend origin

## Authentication modes

- `AUTH_MODE=dev` (default in local development): `/api/auth/login` accepts `{ "email": "user@example.com" }`.
- `AUTH_MODE=oidc` (required in production): `/api/auth/login` accepts `{ "providerToken": "<OIDC JWT>" }` and verifies issuer/audience/JWKS.

`DEV_ADMIN_EMAILS` (comma-separated) grants `admin` role in dev mode for RBAC testing.
`AUTH_OIDC_ROLE_CLAIM` selects the JWT claim used for RBAC role extraction (default: `role`, with fallback support for `https://streetsmart.io/role`).

## Background jobs

`src/queue.mjs` uses **pg-boss** for durable background jobs when `DATABASE_URL` is configured, with an in-process fallback only for local no-DB mode.
Register handlers at startup with `registerJobHandler(name, handler)` and
dispatch work with `enqueue(name, data)`.
Set `PG_BOSS_SCHEMA` to isolate queue tables if needed (default: `pgboss`).

The example `send-welcome-email` job remains wired to run on login.

## Durable audit logging

Audit events are persisted to:
- PostgreSQL `audit_events` table when `DATABASE_URL` is set (default in Docker Compose/prod),
- append-only spool file (`AUDIT_SPOOL_FILE_PATH`) when DB is not configured.

Set `AUDIT_FORWARD_URL` to enable periodic forwarding to SIEM/webhook receivers.

## Manual verification checklist

1. `POST /api/auth/login`:
   - dev mode: `{ "email": "admin@example.com" }` returns token with admin role.
   - oidc mode: `{ "providerToken": "<provider jwt>" }` returns token.
2. `POST /api/uploads/presign` with Bearer token returns `uploadUrl`, `fileUrl`, `expiresInSeconds`.
3. `GET /api/admin/tasks`:
   - admin token → `200`
   - non-admin token → `403`
4. Trigger login and verify:
   - pg-boss tables and job execution logs (`send-welcome-email`).
   - `audit_events` rows insert and `forwarded_at` updates when `AUDIT_FORWARD_URL` is set.
