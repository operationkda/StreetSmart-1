# Backend scaffold (independent from Base44)

This service is a minimal reference backend that you own and can deploy independently.

## What it includes

- `POST /api/auth/login` - issues a signed token (replace with full auth provider in production)
- `GET /api/tasks` and `POST /api/tasks` - authenticated CRUD starter
- `POST /api/uploads/presign` - upload URL placeholder flow
- `POST /api/webhooks/stripe` - webhook signature verification starter

## Run locally

```bash
cd backend
PORT=4000 JWT_SECRET=change-me STRIPE_WEBHOOK_SECRET=whsec_dev node ./src/server.mjs
```

## Production hardening required

- Replace token scheme with real JWT/OIDC
- Move tasks from memory to persistent DB (PostgreSQL recommended)
- Add RBAC, rate limiting, audit logs, and request validation
- Add queue workers for heavy jobs and retries
