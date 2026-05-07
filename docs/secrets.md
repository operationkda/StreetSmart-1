# Secrets provisioning guide

This document lists every secret and variable required to run StreetSmart in production
and explains where to set each one.

---

## How to set GitHub secrets

Go to **Settings → Secrets and variables → Actions** in the GitHub repository.

- **Repository secrets** apply to all workflows.
- **Environment secrets** (under **Settings → Environments → production**) apply only to
  jobs that target the `production` environment and can require reviewer approval.

Prefer environment secrets for anything that gates production deploys.

---

## Backend runtime secrets

Set these as secrets on your hosting platform (Fly.io, Railway, etc.)
_and_ as GitHub environment secrets for the deploy workflow.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `JWT_SECRET` | ✅ | Cryptographically random bytes (see generation commands below). Rotate periodically. |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Signing secret from the Stripe dashboard (Developers → Webhooks). |
| `AUTH_OIDC_ISSUER` | ✅ in prod | OIDC provider issuer URL (e.g. `https://tenant.auth0.com/`). Include trailing slash. |
| `AUTH_OIDC_AUDIENCE` | ✅ in prod | OIDC audience value registered with the provider. |
| `AWS_ACCESS_KEY_ID` | ✅ | R2 or S3 access key ID. |
| `AWS_SECRET_ACCESS_KEY` | ✅ | R2 or S3 secret access key. |
| `ALLOWED_ORIGIN` | ✅ | Frontend origin (e.g. `https://app.example.com`). Restricts CORS. |

### Optional backend secrets

| Variable | Default | Description |
|---|---|---|
| `AUTH_OIDC_JWKS_URI` | derived from issuer | Override only if the provider uses a non-standard JWKS path. |
| `AUTH_OIDC_ROLE_CLAIM` | `role` | JWT claim name that carries the user role. |
| `FILE_BUCKET_ENDPOINT` | _(AWS default)_ | Custom endpoint for S3-compatible stores (e.g. R2). |
| `AUDIT_FORWARD_URL` | _(disabled)_ | Webhook URL to forward audit events to a SIEM. |
| `EMAIL_WEBHOOK_URL` | _(disabled)_ | Webhook URL for briefing delivery (`EMAIL_DELIVERY_MODE=webhook`). |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per window per IP. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in milliseconds. |
| `TOKEN_TTL_SECONDS` | `3600` | Session JWT lifetime in seconds. |

---

## Backend non-secret environment variables

Set these as plain environment variables (not secrets) on the hosting platform.

| Variable | Example | Description |
|---|---|---|
| `PORT` | `4000` | Port the backend listens on. |
| `NODE_ENV` | `production` | Must be `production` in live environments. |
| `AUTH_MODE` | `oidc` | Must be `oidc` in production. `dev` is blocked when `NODE_ENV=production`. |
| `FILE_BUCKET_NAME` | `streetsmart` | S3 or R2 bucket name. |
| `FILE_BUCKET_REGION` | `auto` | Bucket region (`auto` for Cloudflare R2). |
| `FILE_BUCKET_BASE_URL` | `https://files.example.com` | Public base URL for uploaded files. |
| `FILE_BUCKET_KEY_PREFIX` | `uploads` | Path prefix for uploaded objects in the bucket. |
| `EMAIL_DELIVERY_MODE` | `log` or `webhook` | Briefing delivery mode. |
| `PG_BOSS_SCHEMA` | `pgboss` | Schema for the durable job queue. |

---

## Frontend build variable

| Variable | Where to set | Description |
|---|---|---|
| `VITE_API_BASE_URL` | GitHub Actions repository variable (`Settings → Variables → Actions`) | URL of the backend API (e.g. `https://api.example.com`). Baked into the static build. |

Set this as a **repository variable** (not a secret) because it is not sensitive and must be
available at image-build time in the deploy workflow.

---

## GitHub Actions secrets for CI and cutover workflows

| Secret | Workflow | Description |
|---|---|---|
| `CUTOVER_DEV_EMAIL` | `production-cutover.yml` | Email to use for dev-mode auth during cutover verification. |
| `CUTOVER_OIDC_PROVIDER_TOKEN` | `production-cutover.yml` | OIDC token for cutover verification when `auth_mode=oidc`. |

These are set at the repository level. The cutover workflow is run manually and does not
deploy anything — it only validates that the production API is responding correctly.

---

## Secret rotation checklist

Run this checklist at least every 90 days or immediately after any suspected compromise:

- [ ] Rotate `JWT_SECRET` — all active sessions will be invalidated on the next request.
- [ ] Rotate `STRIPE_WEBHOOK_SECRET` in the Stripe dashboard and update the environment.
- [ ] Rotate `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in R2 / IAM and update the environment.
- [ ] Rotate `DATABASE_URL` credentials — requires a coordinated database password change.
- [ ] Review and prune `DEV_ADMIN_EMAILS` (dev mode only; not applicable in production).

---

## Generating strong secrets

```bash
# 32-byte JWT secret (base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 64-byte secret (hex)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
