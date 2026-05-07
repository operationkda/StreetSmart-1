# StreetSmart - Independent Live App

This repository now runs as an independent React app that talks to your own backend service.

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local`:
   ```bash
   VITE_API_BASE_URL=http://localhost:4000
   ```
3. Start frontend:
   ```bash
   npm run dev
   ```
4. Start backend scaffold in another terminal:
   ```bash
   cd backend
   PORT=4000 JWT_SECRET=change-me STRIPE_WEBHOOK_SECRET=whsec_dev node ./src/server.mjs
   ```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Architecture and operations docs

- `docs/architecture.md`
- `docs/operations-runbook.md`
- `docs/migration-checklist.md`
- `backend/README.md`

## Notes

- Base44 dependencies and Vite plugin were removed.
- Frontend now uses `VITE_API_BASE_URL` and an internal API client (`src/api/client.js`).
