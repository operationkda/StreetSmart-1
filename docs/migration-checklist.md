# Base44 migration checklist

1. ✅ Inventory all Base44 SDK/runtime touchpoints
2. ✅ Replace each feature with backend endpoint + frontend API client usage
3. ⬜ Verify parity in staging with user acceptance tests
4. ⬜ Migrate data to owned database
5. ⬜ Shadow traffic and compare responses/metrics
6. ⬜ Cut over DNS/traffic after validation
7. ⬜ Keep rollback window and playbook active until stable

## Notes on remaining steps

**Step 3 — UAT in staging**
Deploy the backend and frontend to your staging environment (see
`docs/operations-runbook.md`). Run through core flows manually or with an
automated test suite:
- Login → receive JWT
- Create and list tasks
- Upload presign request
- Stripe webhook delivery (use the Stripe CLI to replay events)

**Step 4 — Data migration**
Export records from the Base44 data store (CSV or JSON via their export API)
and load them into owned PostgreSQL with a one-time import script.
Run `npm run migrate` (or apply `backend/src/db.mjs` `migrate()` once) before
importing.

**Step 5 — Shadow traffic**
Route a copy of production requests to the new backend alongside the old one.
Compare response bodies and latency for at least 24–48 hours.

**Step 6 — DNS / traffic cutover**
Update `VITE_API_BASE_URL` (or your reverse-proxy upstream) to point to the
new backend. Monitor error rates and latency dashboards for 30 minutes before
removing the old backend.

**Step 7 — Rollback window**
Keep the old Base44 environment accessible for 48 hours post-cutover.
The rollback procedure is in `docs/operations-runbook.md`.
