# StreetSmart backend (independent from Base44)

Owned Node.js API service with PostgreSQL persistence, HS256 JWT auth,
RBAC, rate limiting, request validation, audit logging, and a background
job queue.

## Endpoints

| Method | Path                    | Auth required | Notes                                     |
|--------|-------------------------|:-------------:|-------------------------------------------|
| POST   | `/api/auth/login`       | —             | Returns a signed HS256 JWT                |
| GET    | `/api/tasks`            | ✓             | Lists tasks for the authenticated user    |
| POST   | `/api/tasks`            | ✓             | Creates a task                            |
| POST   | `/api/uploads/presign`  | ✓             | Returns a presigned upload URL (stub)     |
| POST   | `/api/webhooks/stripe`  | —             | Verifies Stripe signature and dispatches  |

## Local development (without Docker)

```bash
cp .env.example .env          # fill in JWT_SECRET at minimum
cd backend
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
- `FILE_BUCKET_BASE_URL`
- `ALLOWED_ORIGIN` — restrict CORS to your frontend origin

## Background jobs

`src/queue.mjs` provides a lightweight in-process job queue with retries.
Register handlers at startup with `registerJobHandler(name, handler)` and
dispatch work with `enqueue(name, data)`.

For high-throughput or durable jobs, replace this module with
**BullMQ** (Redis-backed) or **pg-boss** (PostgreSQL-backed).

## Next hardening steps

- Replace email-only login with a real identity provider (Auth0, Cognito, Clerk)
- Wire `FILE_BUCKET_BASE_URL` to a real S3-compatible bucket with AWS SDK v3 presigning
- Add per-route RBAC enforcement using the `hasRole()` helper and an `admin` role
- Add audit-log flushing to a write-ahead store or SIEM
- Replace the in-process queue with BullMQ or pg-boss for durability
