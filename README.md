# StreetSmart - Independent Operations Console

StreetSmart now targets a fully independent architecture: a React frontend, an owned backend API, PostgreSQL-backed operational data, and S3-compatible media storage.

## What is implemented in this slice

This repository now focuses on the first real StreetSmart feature slice instead of the task demo:

- threat briefing dashboard
- tactical zone awareness (safe and danger zones)
- active advisories
- personal intel log
- profile and security posture settings
- admin operations overview

## Local development

1. Install frontend dependencies:
   ```bash
   cd /home/runner/work/StreetSmart-1/StreetSmart-1
   npm install
   ```
2. Create `/home/runner/work/StreetSmart-1/StreetSmart-1/.env.local`:
   ```bash
   VITE_API_BASE_URL=http://localhost:4000
   ```
3. Start the frontend:
   ```bash
   cd /home/runner/work/StreetSmart-1/StreetSmart-1
   npm run dev
   ```
4. Start the backend in another terminal:
   ```bash
   cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
   cp .env.example .env
   npm install
   npm run dev
   ```

## Quality checks

Frontend:
```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1
npm run lint
npm run typecheck
npm run build
```

Backend:
```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
npm run check
```

## Architecture and operations docs

- `docs/launch-checklist.md` — end-to-end checklist from new repo to working on your phone
- `docs/mobile.md` — PWA and Capacitor native packaging strategy
- `docs/architecture.md`
- `docs/operations-runbook.md`
- `docs/migration-checklist.md`
- `docs/hosting.md`
- `docs/secrets.md`
- `backend/README.md`

## Direction

StreetSmart is aligned to the independent backend architecture in this repository. Base44 is treated as a migration source only where legacy data still needs to be transformed and imported.
