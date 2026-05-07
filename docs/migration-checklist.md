# Migration checklist

## Current position

- ✅ StreetSmart is aligned to the independent backend architecture in this repository.
- ✅ The task demo has been replaced by the first StreetSmart operational slice.
- ✅ Staging validation and migration tooling remain available for legacy data if needed.

## If legacy Base44 data still exists

### Step 1 — Confirm source data scope

Inventory the legacy records that still matter for launch, especially:

- user-linked notes or reports that should become `intel_entries`
- contact or account metadata that should inform `profiles`
- any files that require object-storage migration

### Step 2 — Transform exports into StreetSmart formats

Use the transform script to normalize Base44 exports into the import shape expected by the backend:

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
npm run data:transform -- ./tmp/base44-export.json ./tmp/intel-import.json
```

The current transform targets:

- `id`
- `title`
- `details`
- `priority`
- `location`
- `owner`
- `created_at`

### Step 3 — Import in staging first

```bash
cd /home/runner/work/StreetSmart-1/StreetSmart-1/backend
npm run data:import -- ./tmp/intel-import.json
npm run data:export -- ./tmp/post-import-export.json
```

Validate counts and spot-check owners, priorities, and timestamps.

### Step 4 — Run staging UAT

Run the documented smoke checks after import:

- auth login
- briefing retrieval
- advisories and zones retrieval
- intel list and intel creation
- admin overview RBAC
- upload presign
- Stripe webhook replay

### Step 5 — Production cutover only if needed

If there is no legacy Base44 deployment or data to preserve, skip migration entirely and continue operating on the independent StreetSmart stack.

If production cutover is required, run the non-destructive verification workflow before routing traffic:

- GitHub Actions → `Production Cutover Verification (Step 5)` (manual dispatch)
- required input: `cutover_base_url`
- optional inputs: `auth_mode`, `admin_expected_status`, `timeout_ms`
- required secret for `auth_mode=dev`: `CUTOVER_DEV_EMAIL`
- required secret for `auth_mode=oidc`: `CUTOVER_OIDC_PROVIDER_TOKEN`
