# Operations runbook

## Environments

- `dev`: local/staging parity
- `staging`: pre-prod verification
- `prod`: customer traffic

## Required environment variables

Frontend:
- `VITE_API_BASE_URL`

Backend:
- `PORT`
- `JWT_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- `FILE_BUCKET_BASE_URL`
- `DATABASE_URL` (when DB is wired)

## Deploy checklist

1. Run CI (`lint`, `typecheck`, `build`)
2. Apply DB migrations
3. Deploy backend
4. Deploy frontend
5. Run smoke tests and webhook checks

## Monitoring and alerting

- API latency/error-rate dashboards
- Uptime checks for frontend and backend
- Structured backend logs with request IDs
- Error tracker alerts to on-call

## Rollback

1. Roll back frontend artifact to previous release
2. Roll back backend deployment
3. If migration failed, execute rollback migration or restore backup
4. Validate core login + CRUD flow
