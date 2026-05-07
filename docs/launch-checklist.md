# StreetSmart Launch Checklist

End-to-end checklist from "new repository" to "working on your phone."
Update each item as it is completed.

---

## Phase 1 — Repository and architecture ✅

- [x] Repository created (`operationkda/StreetSmart-1`).
- [x] App architecture defined: React frontend, Node.js backend, PostgreSQL, S3-compatible storage.
- [x] Core feature slice implemented: threat briefing, tactical zones, active advisories, intel log, profile, admin overview.
- [x] Local development instructions documented in `README.md` and `backend/README.md`.
- [x] Validation commands defined:
  - Frontend: `npm run lint && npm run typecheck && npm run build`
  - Backend: `npm run check`
- [x] Hosting and deploy guidance documented in `docs/hosting.md`.
- [x] Operations runbook and smoke-test checklist documented in `docs/operations-runbook.md`.
- [x] Migration from legacy Base44 data documented and marked optional in `docs/migration-checklist.md`.
- [x] Web app manifest (`public/manifest.json`) in place for mobile "Add to Home Screen" support.

---

## Phase 2 — Production provisioning

- [ ] Create backend hosting account (Fly.io or Railway) and create the `streetsmart-backend` app.
- [ ] Create a managed PostgreSQL database (Neon or Railway Postgres) and note the connection string.
- [ ] Create a Cloudflare R2 bucket (`streetsmart`) and generate an R2 API token.
- [ ] Set up an Auth0 (or Clerk) tenant; create an API and a Single Page Application entry.
- [ ] Create a Cloudflare Pages project (or Netlify site) connected to this repository.

---

## Phase 3 — Secrets and environment configuration

- [ ] Generate a strong `JWT_SECRET` (e.g. `openssl rand -base64 48`).
- [ ] Set all required backend secrets on the hosting platform (see `docs/secrets.md` for the full list):
  - `DATABASE_URL`, `JWT_SECRET`, `STRIPE_WEBHOOK_SECRET`
  - `AUTH_MODE=oidc`, `AUTH_OIDC_ISSUER`, `AUTH_OIDC_AUDIENCE`
  - `FILE_BUCKET_NAME`, `FILE_BUCKET_REGION`, `FILE_BUCKET_ENDPOINT`, `FILE_BUCKET_BASE_URL`
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
  - `ALLOWED_ORIGIN` (set to the live frontend URL)
- [ ] Add the same backend secrets as GitHub environment secrets under the `production` environment (required for the CI deploy workflow).
- [ ] Set `VITE_API_BASE_URL` to the live backend URL in the frontend hosting environment.

---

## Phase 4 — First deploy

- [ ] Run frontend validation locally before pushing:
  ```bash
  npm run lint && npm run typecheck && npm run build
  ```
- [ ] Run backend validation locally before pushing:
  ```bash
  cd backend && npm run check
  ```
- [ ] Push to `main` — the `deploy.yml` workflow builds and publishes Docker images automatically.
- [ ] Trigger or confirm the backend container deploy to the hosting platform.
- [ ] Confirm the frontend static site deploys via Cloudflare Pages / Netlify.
- [ ] Verify the backend health endpoint responds: `GET https://<backend-domain>/api/health`.

---

## Phase 5 — Staging smoke tests

- [ ] Run the UAT smoke suite against the staging backend:
  ```bash
  cd backend
  UAT_BASE_URL=https://staging-api.example.com \
  UAT_AUTH_MODE=dev \
  UAT_DEV_EMAIL=admin@example.com \
  UAT_ADMIN_EXPECTED_STATUS=200 \
  npm run uat:smoke
  ```
- [ ] Manually verify the critical paths:
  - `POST /api/auth/login`
  - `GET /api/briefing`
  - `GET /api/zones`
  - `GET /api/advisories`
  - `GET /api/intel` then `POST /api/intel`
  - `GET /api/profile` then `PUT /api/profile`
  - `GET /api/admin/overview` with an admin token
  - `POST /api/uploads/presign`
  - Stripe webhook replay for `payment_intent.succeeded`

---

## Phase 6 — Production cutover

- [ ] Run the production cutover verification via GitHub Actions:
  - Workflow: **Production Cutover Verification (Step 5)** (manual dispatch)
  - Required input: `cutover_base_url` (live backend URL)
  - See `docs/operations-runbook.md` for full input/secret reference.
- [ ] Confirm `ALLOWED_ORIGIN` on the backend matches the live frontend domain exactly.
- [ ] Monitor logs and dashboards for 30 minutes after cutover before marking the deploy stable.
- [ ] Set up uptime checks on `GET /api/health` (BetterUptime or UptimeRobot).

---

## Phase 7 — Working on your phone

- [ ] Open the live frontend URL in your phone's browser (iOS Safari or Android Chrome).
- [ ] Sign in with your OIDC credentials.
- [ ] Confirm the briefing, zones, and advisories load correctly.
- [ ] Add PWA icons to `public/icons/`:
  - `icon-192.png` (192 × 192 px) and `icon-512.png` (512 × 512 px)
  - Tools: Figma export, RealFaviconGenerator, or any image editor. Keep the background opaque so the `maskable` purpose renders correctly on Android.
- [ ] **Add to Home Screen** for an app-like experience:
  - **iOS Safari**: tap the Share icon → "Add to Home Screen"
  - **Android Chrome**: tap the three-dot menu → "Add to Home Screen" (or install the PWA prompt)
- [ ] Verify the app launches from the Home Screen icon in standalone mode (no browser chrome).

---

## Post-launch

- [ ] Complete the secret-rotation schedule documented in `docs/secrets.md`.
- [ ] Assign ownership roles defined in `docs/hosting.md` (deploys, backups, on-call, secret rotation, status page).
- [ ] Import any required legacy data using `npm run data:transform` then `npm run data:import` (see `docs/migration-checklist.md`).
