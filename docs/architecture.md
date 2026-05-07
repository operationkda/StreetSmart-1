# StreetSmart target architecture

## Chosen direction

StreetSmart runs as a fully independent application stack:

- React + Vite frontend in `/home/runner/work/StreetSmart-1/StreetSmart-1`
- owned backend API in `/home/runner/work/StreetSmart-1/StreetSmart-1/backend`
- PostgreSQL for persistent operational data
- S3-compatible object storage for uploads
- OIDC-compatible identity provider for production auth

No Base44 runtime dependencies are part of the target architecture.

## Implemented vertical slice

The first implemented StreetSmart slice covers:

- authenticated threat briefing
- tactical zone awareness with safe and danger zones
- advisories feed
- personal intel log
- profile and security posture settings
- admin operations overview

## Runtime boundaries

- Frontend calls only `VITE_API_BASE_URL`
- Backend owns auth, authorization, intel persistence, profile security settings, upload signing, and webhook verification
- Background jobs are handled by worker processes and a durable queue (`pg-boss`)
- Audit events are persisted for security-sensitive actions

## Data model in this slice

Persistent tables:

- `intel_entries` — owner-scoped field reports
- `profiles` — owner-scoped call sign, home zone, security posture, emergency contacts
- `audit_events` — durable audit trail

Seeded operational reference data:

- tactical zones
- advisories

## Security baseline

- HTTPS only in deployed environments
- OIDC identity provider integration for production
- JWT session tokens issued by the backend after login
- least-privilege service accounts
- secret-managed signing and webhook keys
- durable audit trail with optional forwarding hook
