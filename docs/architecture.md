# StreetSmart target architecture (fully independent)

## Chosen target

StreetSmart will run as a **full-stack independent app**:

- React + Vite frontend (this repository)
- Owned backend API service (under `backend/` scaffold)
- Owned data store (PostgreSQL recommended)
- Owned object storage for media

No Base44 runtime components are required.

## Runtime boundaries

- Frontend calls only `VITE_API_BASE_URL`
- Backend owns auth, authorization, CRUD, file upload signing, and webhooks
- Background jobs are handled by worker processes and a queue

## Deployment topology

- Frontend: static hosting/CDN
- Backend API: containerized service
- Database: managed PostgreSQL
- Storage: S3-compatible bucket

## Security baseline

- HTTPS only
- Secret manager for JWT/signing keys
- Rotation policy for secrets and webhook keys
- Least-privilege service accounts
