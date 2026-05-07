# StreetSmart backend

Owned Node.js API service with PostgreSQL persistence, configurable auth, RBAC, rate limiting, upload signing, durable audit logging, and a durable background job queue.

## Endpoints

| Method | Path                    | Auth required | Notes |
|--------|-------------------------|:-------------:|-------|
| GET    | `/api/health`           | —             | Returns service status, DB connectivity, uptime, and version |
| POST   | `/api/auth/login`       | —             | Dev email login or OIDC token verification |
| GET    | `/api/briefing`         | ✓             | Returns the authenticated user's threat briefing |
| GET    | `/api/zones`            | ✓             | Returns tactical safe and danger zones |
| GET    | `/api/advisories`       | ✓             | Returns active advisory feed |
| GET    | `/api/intel`            | ✓             | Lists owner-scoped intel reports |
| POST   | `/api/intel`            | ✓             | Creates an owner-scoped intel report |
| DELETE | `/api/intel/:id`        | ✓             | Deletes an owner-scoped intel report |
| GET    | `/api/profile`          | ✓             | Returns owner-scoped profile and security posture |
| PUT    | `/api/profile`          | ✓             | Updates owner-scoped security posture |
| GET    | `/api/admin/overview`   | admin         | Returns admin operational summary and recent intel |
| POST   | `/api/uploads/presign`  | ✓             | Returns S3-compatible presigned PUT URL |
| POST   | `/api/webhooks/stripe`  | —             | Verifies Stripe signature and records event handling |

## Local development

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
cp .env.example .env
npm install
npm run dev
```

If `DATABASE_URL` is not set the server falls back to in-memory stores for intel and profile data. That is acceptable for local UI work only.

## Environment variables

See `/home/runner/work/StreetSmart-1/StreetSmart-1/backend/.env.example` for the complete list.

## Authentication modes

- `AUTH_MODE=dev`: `/api/auth/login` accepts `{ "email": "user@example.com" }`
- `AUTH_MODE=oidc`: `/api/auth/login` accepts `{ "providerToken": "<OIDC JWT>" }`

`DEV_ADMIN_EMAILS` grants admin access in dev mode.

## Background jobs

The backend dispatches a `dispatch-security-briefing` job on login. By default it logs delivery attempts. If `EMAIL_DELIVERY_MODE=webhook`, the job posts to `EMAIL_WEBHOOK_URL`.

## Durable audit logging

Audit events are persisted to PostgreSQL `audit_events` when `DATABASE_URL` is configured, or to the append-only spool file at `AUDIT_SPOOL_FILE_PATH` when running without a DB.

## Manual verification checklist

1. `POST /api/auth/login`
2. `GET /api/briefing`
3. `GET /api/zones`
4. `GET /api/advisories`
5. `POST /api/intel` then `GET /api/intel`
6. `GET /api/profile` then `PUT /api/profile`
7. `GET /api/admin/overview` with an admin token
8. `POST /api/uploads/presign`
9. Signed Stripe webhook replay for `payment_intent.succeeded`

## Staging smoke/UAT automation

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
UAT_BASE_URL=https://staging-api.example.com \
UAT_AUTH_MODE=dev \
UAT_DEV_EMAIL=admin@example.com \
UAT_ADMIN_EXPECTED_STATUS=200 \
npm run uat:smoke
```

## Production cutover verification (Step 5)

Use the read-focused cutover verification for production readiness checks:

```bash
cd backend
CUTOVER_BASE_URL=https://api.example.com \
CUTOVER_AUTH_MODE=dev \
CUTOVER_DEV_EMAIL=admin@example.com \
CUTOVER_ADMIN_EXPECTED_STATUS=200 \
npm run cutover:verify
```

## Base44 export normalization for import

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
npm run data:transform -- ./tmp/base44-export.json ./tmp/intel-import.json
npm run data:import -- ./tmp/intel-import.json
```
