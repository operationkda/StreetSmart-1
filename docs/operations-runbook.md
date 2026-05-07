# Operations runbook

## Environments

- `dev`: local/staging parity
- `staging`: pre-prod verification
- `prod`: customer traffic

## Required environment variables

Frontend:
- `VITE_API_BASE_URL`

Backend (see `backend/.env.example` for full list):
- `PORT`
- `JWT_SECRET` — ≥ 32 random bytes; rotate via secret manager
- `STRIPE_WEBHOOK_SECRET`
- `AUTH_MODE=oidc`
- `AUTH_OIDC_ISSUER`
- `AUTH_OIDC_AUDIENCE`
- `AUTH_OIDC_JWKS_URI` (optional override)
- `FILE_BUCKET_BASE_URL`
- `FILE_BUCKET_NAME`
- `FILE_BUCKET_REGION`
- `FILE_BUCKET_ENDPOINT` (optional for S3-compatible providers)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or workload identity)
- `DATABASE_URL` — PostgreSQL connection string
- `ALLOWED_ORIGIN` — restrict CORS in production (e.g. `https://app.streetsmart.io`)
- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` — optional tuning
- `AUDIT_FORWARD_URL` (optional SIEM/webhook sink)

## Deploy checklist

1. Run CI (`lint`, `typecheck`, `build` for frontend; `check` for backend)
2. Apply DB migrations — migrations run automatically on startup via `migrate()` in `backend/src/db.mjs`
3. Deploy backend (`docker build ./backend && docker push ...`, then update service)
4. Deploy frontend (`npm run build` → upload `dist/` to CDN / static host)
5. Run smoke tests:
   - `POST /api/auth/login`:
     - dev: body with `email`
     - prod: body with `providerToken` from Auth0/Cognito/Clerk
   - `GET /api/tasks` with Bearer token → 200
   - `GET /api/admin/tasks` with admin role token → 200
   - Stripe webhook replay via `stripe trigger payment_intent.succeeded`
   - `POST /api/uploads/presign` returns `uploadUrl` + `fileUrl` + `expiresInSeconds`
6. Monitor dashboards for 30 minutes before marking deploy stable

## Monitoring and alerting

- API latency/error-rate dashboards
- Uptime checks for frontend and backend
- Structured backend logs with request IDs (JSON, one entry per line)
- Audit log stream (`audit` level entries) forwarded to your SIEM
- Error tracker alerts to on-call

## Rollback

1. Roll back frontend artifact to previous CDN release
2. Roll back backend container to the previous image tag
3. If a migration ran, execute the inverse SQL or restore from the pre-deploy snapshot
4. Validate core login + task CRUD flow
5. Update status page
