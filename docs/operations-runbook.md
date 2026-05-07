# Operations runbook

## Environments

- `dev`: local development and fast validation
- `staging`: pre-production verification
- `prod`: customer traffic

## Required environment variables

Frontend:
- `VITE_API_BASE_URL`

Backend:
- `PORT`
- `JWT_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- `AUTH_MODE=oidc`
- `AUTH_OIDC_ISSUER`
- `AUTH_OIDC_AUDIENCE`
- `AUTH_OIDC_JWKS_URI` (optional override)
- `FILE_BUCKET_BASE_URL`
- `FILE_BUCKET_NAME`
- `FILE_BUCKET_REGION`
- `FILE_BUCKET_ENDPOINT` (optional)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `DATABASE_URL`
- `PG_BOSS_SCHEMA` (optional)
- `ALLOWED_ORIGIN`
- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`
- `AUDIT_FORWARD_URL` (optional)
- `EMAIL_DELIVERY_MODE` / `EMAIL_WEBHOOK_URL` (optional briefing-delivery integration)

## Deploy checklist

1. Run frontend validation:
   ```bash
   cd /home/runner/work/StreetSmart-1/StreetSmart-1
   npm run lint && npm run typecheck && npm run build
   ```
2. Run backend validation:
   ```bash
   cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
   npm run check
   ```
3. Apply DB migrations by starting the backend in the target environment.
4. Deploy backend container.
5. Deploy frontend static artifact.
6. Run smoke tests:
   - `POST /api/auth/login`
   - `GET /api/briefing`
   - `GET /api/advisories`
   - `GET /api/zones`
   - `GET /api/intel`
   - `GET /api/admin/overview` with an admin token
   - `POST /api/uploads/presign`
   - replay `payment_intent.succeeded` Stripe webhook
7. Monitor logs and dashboards for 30 minutes before marking deploy stable.

## Suggested staging command sequence

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1
npm run lint && npm run typecheck && npm run build

cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
npm run check
UAT_BASE_URL=https://staging-api.example.com \
UAT_AUTH_MODE=dev \
UAT_DEV_EMAIL=admin@example.com \
UAT_ADMIN_EXPECTED_STATUS=200 \
npm run uat:smoke
```

OIDC variant:

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
UAT_BASE_URL=https://staging-api.example.com \
UAT_AUTH_MODE=oidc \
UAT_OIDC_PROVIDER_TOKEN=<provider-jwt> \
UAT_ADMIN_EXPECTED_STATUS=200 \
npm run uat:smoke
```

## Monitoring and alerting

- API latency and error-rate dashboards
- uptime checks for frontend and backend
- structured backend logs with request IDs
- audit event forwarding to SIEM/webhook receivers
- queue health and retry monitoring for briefing delivery jobs

## Rollback

1. Roll back frontend artifact to the previous release.
2. Roll back backend container image.
3. Restore PostgreSQL from the pre-deploy snapshot if required.
4. Validate login, briefing, advisories, zones, intel log, and admin overview.
5. Update the status page and incident log.
