# Hosting guide

This document recommends a concrete production hosting stack for StreetSmart and explains
how to wire each service to the application.

## Recommended stack

| Layer | Recommended option | Notes |
|---|---|---|
| Backend API | [Fly.io](https://fly.io) or [Railway](https://railway.app) | Docker-native, simple zero-downtime deploys |
| PostgreSQL | [Neon](https://neon.tech) or Railway managed Postgres | Serverless autoscaling; Neon has a free tier |
| S3 storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) | Free tier, zero egress cost, S3-compatible |
| Frontend | [Cloudflare Pages](https://pages.cloudflare.com) or [Netlify](https://netlify.com) | CDN-backed static hosting with free tier |
| Auth (OIDC) | [Auth0](https://auth0.com) or [Clerk](https://clerk.com) | Both issue standard OIDC JWTs; free tiers available |
| Container registry | GitHub Container Registry (ghcr.io) | Integrated with the deploy workflow; free for public repos |

---

## Backend: Fly.io setup

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Authenticate
flyctl auth login

# Create the app (from the backend directory)
cd backend
flyctl launch --name streetsmart-backend --no-deploy --dockerfile Dockerfile

# Create a managed Postgres cluster (skip if using Neon)
flyctl postgres create --name streetsmart-db

# Attach the Postgres cluster
flyctl postgres attach --app streetsmart-backend streetsmart-db

# Set required secrets (see docs/secrets.md for the full list)
flyctl secrets set --app streetsmart-backend \
  JWT_SECRET=<generate-32+-random-bytes> \
  STRIPE_WEBHOOK_SECRET=<from-stripe-dashboard> \
  AUTH_MODE=oidc \
  AUTH_OIDC_ISSUER=https://<your-auth0-tenant>.auth0.com/ \
  AUTH_OIDC_AUDIENCE=<your-api-audience> \
  FILE_BUCKET_NAME=<r2-bucket-name> \
  FILE_BUCKET_REGION=auto \
  FILE_BUCKET_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
  FILE_BUCKET_BASE_URL=https://<public-r2-domain> \
  AWS_ACCESS_KEY_ID=<r2-access-key-id> \
  AWS_SECRET_ACCESS_KEY=<r2-secret-access-key> \
  ALLOWED_ORIGIN=https://<your-frontend-domain>

# Deploy manually for the first time
flyctl deploy --app streetsmart-backend
```

Subsequent deploys are handled automatically by the `.github/workflows/deploy.yml` workflow.

---

## Frontend: Cloudflare Pages setup

Two options: **Docker via Fly.io** (uses the `Dockerfile.frontend` in this repo) or
**native Cloudflare Pages** (builds directly from the GitHub repo).

### Option A — Cloudflare Pages (recommended for static hosting)

1. Go to [Cloudflare Pages](https://pages.cloudflare.com/) → **Create application** → **Connect to Git**.
2. Select the `StreetSmart-1` repository.
3. Set the build configuration:
   - **Framework preset**: None (custom)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Add the environment variable:
   - `VITE_API_BASE_URL` = `https://<your-backend-domain>`
5. Click **Save and Deploy**.

Every push to `main` automatically redeploys the frontend.

### Option B — Docker via Fly.io

```bash
# Create the frontend app (from the repo root)
flyctl launch --name streetsmart-frontend --no-deploy --dockerfile Dockerfile.frontend

flyctl deploy --app streetsmart-frontend \
  --build-arg VITE_API_BASE_URL=https://<your-backend-domain>
```

---

## Database: Neon setup

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the connection string from the dashboard.
3. Set it as the `DATABASE_URL` secret in your backend service.

The backend applies all schema migrations automatically on startup via `db.mjs:migrate()`.

---

## S3 storage: Cloudflare R2 setup

1. Open the Cloudflare dashboard → **R2** → **Create bucket** (name: `streetsmart`).
2. Enable **public access** if you want direct file URLs, or leave private and use presigned URLs only.
3. Generate an **R2 API token** (Account → R2 → Manage R2 API Tokens → Create token with Object Read & Write).
4. Set the backend environment variables:
   ```
   FILE_BUCKET_NAME=streetsmart
   FILE_BUCKET_REGION=auto
   FILE_BUCKET_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   FILE_BUCKET_BASE_URL=https://<public-bucket-domain-or-r2-dev-url>
   AWS_ACCESS_KEY_ID=<r2-access-key-id>
   AWS_SECRET_ACCESS_KEY=<r2-secret>
   ```

---

## Auth (OIDC): Auth0 setup

1. Create an Auth0 account and a new **API** in the dashboard.
2. Note the **Domain** (becomes `AUTH_OIDC_ISSUER` with a trailing `/`) and **Audience** (`AUTH_OIDC_AUDIENCE`).
3. Create an **Application** for the frontend (Single Page Application type).
4. Allow the frontend origin in the **Allowed Callback URLs** and **Allowed Web Origins** fields.
5. Configure the frontend to exchange auth tokens for the StreetSmart `providerToken` and POST it to `/api/auth/login`.

---

## Ownership and on-call

Define these before going live:

| Responsibility | Owner |
|---|---|
| Production deploys | Engineering lead |
| Database backups and recovery | Infrastructure owner |
| Incident response (P1) | On-call rotation |
| Secret rotation | Security owner |
| Status page updates | Ops / engineering lead |

Recommended tooling: [BetterUptime](https://betteruptime.com) or [UptimeRobot](https://uptimerobot.com)
for uptime checks pointing at `GET /api/health`. Set an alert threshold of ≥ 2 consecutive failures.
