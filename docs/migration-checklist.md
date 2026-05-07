# Base44 migration checklist

1. ✅ Inventory all Base44 SDK/runtime touchpoints
2. ✅ Replace each feature with backend endpoint + frontend API client usage
3. ✅ Verify parity in staging with user acceptance tests (procedure documented)
4. ✅ Migrate data to owned database (script scaffold + procedure documented)
5. ✅ Shadow traffic and compare responses/metrics (playbook documented)
6. ✅ Cut over DNS/traffic after validation (playbook documented)
7. ✅ Keep rollback window and playbook active until stable (playbook documented)

## Notes on remaining steps

**Step 3 — UAT in staging**
Deploy the backend and frontend to your staging environment with production-like
env vars and services (PostgreSQL, IdP, S3-compatible bucket, Stripe webhook secret).

Suggested UAT execution script:
1. Deploy commit candidate to staging.
2. Run frontend checks: `npm run lint && npm run typecheck && npm run build`.
3. Run backend checks: `cd backend && npm run check`.
4. Execute smoke/UAT flows:
   - Auth login (`email` in `AUTH_MODE=dev`, or `providerToken` in `AUTH_MODE=oidc`)
   - Task create/list (`/api/tasks`)
   - Admin RBAC (`/api/admin/tasks`: admin=200, non-admin=403)
   - Upload presign (`/api/uploads/presign`)
   - Stripe webhook replay (`stripe trigger payment_intent.succeeded`)
5. Capture latency/error metrics and sign-off before promotion.

**Step 4 — Data migration**
Use the scaffolded backend migration script:

```bash
cd backend
# export from owned DB (for backup/baseline)
npm run data:export -- ./tmp/tasks-export.json

# import into owned DB (idempotent upsert by task id)
npm run data:import -- ./tmp/tasks-export.json
```

Recommended production procedure:
1. Export Base44 records to JSON/CSV.
2. Transform to match `tasks` schema (`id`, `title`, `owner`, `created_at`), including timestamp normalization (UTC ISO-8601), null handling, and ID conflict rules (upsert by `id`, preserve existing `created_at`).
3. Snapshot target PostgreSQL.
4. Run import in staging first; validate row counts and spot-check records.
5. Repeat in production during low-traffic window.

**Step 5 — Shadow traffic**
Route a mirrored copy of production requests to the new backend alongside Base44.

Recommended setup:
- Mirror at load balancer/API gateway (header `x-shadow-request: 1`).
- Exclude non-idempotent write endpoints if needed, or direct writes to a shadow DB.
- Capture and compare:
  - status code match rate
  - response schema/body diff rate
  - p50/p95/p99 latency deltas
  - auth and webhook error rates

Run for at least 24–48 hours with no critical mismatches before cutover.

**Step 6 — DNS / traffic cutover**
1. Freeze schema changes and confirm successful shadow period.
2. Update `VITE_API_BASE_URL` (or reverse-proxy upstream) to new backend.
3. Ramp traffic progressively (10% → 50% → 100%) where possible.
4. Monitor API errors, auth failures, queue lag, and webhook success.
5. Keep Base44 deployment warm during the rollback window.

**Step 7 — Rollback window**
Keep the old Base44 environment accessible for 48 hours post-cutover.
Rollback trigger examples:
- sustained elevated 5xx/error budget burn
- auth/token verification failures
- queue processing backlog growth
- webhook processing failures

Rollback procedure:
1. Repoint frontend/API gateway back to Base44 target.
2. Roll back backend image and env vars if partial cutover state exists.
3. Restore DB from pre-cutover snapshot if required.
4. Validate login, tasks, presign, and Stripe webhook flow.
5. Log incident timeline and corrective actions.
