# Pilot Security Hardening - ARENA-RABITA-PILOT-HARDENING-001

Status: implemented for the controlled pilot release classification
"B. CONTROLLED PILOT READY WITH NON-BLOCKING DEBT".

This document records the concrete security/contract defects closed by the
pilot hardening task, the configuration contract, and the debt that remains.
It is written so an operator cannot accidentally weaken the governed model.

## 1. Governed Result protection (legacy route closure)

The legacy administration routes can no longer overwrite governed Results:

| Legacy route | Behavior now |
| --- | --- |
| `PATCH /api/v1/admin/results/:id` | Allowed only while the row is `LEGACY_UNRESOLVED`. Any governed lifecycle row (`DRAFT`, `SUBMITTED`, `VALIDATED`, `REJECTED`, `VOID`, `ARCHIVED`) returns `409 governed_result_immutable`; corrections must use `POST /api/v1/admin/competition-results/:id/revisions` plus a validation decision (`validated` / `rejected` / `void`) which supersedes the prior authoritative validation. |
| `POST /api/v1/admin/results/:id/status` | Same guard: governed rows return `409 governed_result_immutable`. Archiving governed results happens only through `POST /api/v1/admin/competition-results/:id/archive` (database-controlled `archived_at`). |
| `POST /api/v1/admin/:entity/:id/archive` | The generic archive route no longer accepts `entity=results` at all (it was already non-functional because result archival timestamps are database-controlled). Use the governed result archive flow. |

Database triggers from migrations 023–025 remain the backstop: payload/context of
a validated, rejected, voided, or archived result is immutable at the schema
level even if application code regresses.

Correction flow guarantees (unchanged by this task, proven by tests):

- Every correction inserts an append-only `result_revisions` row; historical
  revisions remain queryable via `GET /api/v1/admin/competition-results/:id/history`.
- A new authoritative decision must explicitly supersede the current one
  (`supersedesValidationId`); the superseded validation stays in history but no
  longer satisfies "current validated" checks.

## 2. Downstream evidence staleness

Qualification and ranking consumers only accept **current** validated evidence:

- `POST /api/v1/admin/qualifications/:id/evidence` validates that the referenced
  validation is still the current authoritative VALIDATED decision at the latest
  revision (`422 invalid_context` otherwise).
- Database triggers (migrations 026–034) enforce the same staleness rules when
  qualifications are approved and when ranking inputs/rows are frozen, so stale
  evidence can never be approved through any path.

## 3. Archive scope (IDOR)

The generic archive route enforces resource scope twice:

1. The shared admin `preHandler` policy check (`requirePolicy` +
   `canAccessResource`), unchanged.
2. Defense-in-depth inside the handler itself: any non-national caller is
   re-checked with `canAccessResource` before the update; failure writes an
   `ARCHIVE_SCOPE_DENIED` audit event and returns `403 {error:"forbidden"}`.

Therefore:

- Institution A cannot archive Institution B resources; daira/association
  scoping applies identically.
- Foreign-but-existing IDs follow the established API-wide policy: `403`
  (existence revelation trade-off is consistent with all other admin routes).
- Unknown IDs return `404 not_found`.
- No broad permission (including `season.archive`) bypasses ownership/scope;
  only SYSTEM/NATIONAL administrators operate globally by design.

## 4. AUTH_SECRET policy

Enforced in `backend/src/config.ts` at startup:

- `NODE_ENV=production` (use this for production **and** remotely accessible
  pilot/staging): explicit `AUTH_SECRET` required, minimum 32 characters,
  known placeholder/default values rejected. Startup fails fast with an error
  that never echoes the secret value. `DATABASE_URL` and `CORS_ALLOWED_ORIGINS`
  are likewise mandatory.
- `NODE_ENV=development`/`test` on a developer machine only: an isolated
  development fallback exists so local work boots without configuration. It is
  never acceptable in a deployment; deployments run `NODE_ENV=production`.
- Secret values are never logged by the application or migration tooling.

## 5. Public data surfaces (governed data only)

New/changed public endpoints expose governed official data exclusively:

- `GET /api/v1/public/results` - safe public Result DTO. Only rows that are
  governed (`governed_status='VALIDATED'`), currently validated (decision not
  superseded and attached to the latest revision), non-archived, inside a
  competition in RESULTS/CLOSED state. Exposed fields: competition/season/event/
  category context, stage level code, held time, public competitor identity
  (**institution/team name only** - never participant personal names),
  official placement `position`/`points` when present in the current official
  ranking, and publication timestamp. Raw `result_data`, `official_payload`,
  validation metadata, audit metadata, measurement details, and internal JSON
  are never exposed.
- `GET /api/v1/public/awards` - governed awards with `status='ISSUED'` only.
  Draft, revoked, archived awards are excluded by construction.
- `GET /api/v1/public/records` - current official rankings: terminal nodes of
  each supersession chain whose status is `VALIDATED`/`PUBLISHED` and not
  archived. Superseded, draft, archived snapshots are never listed as current.

There are **no legacy honor or sport-record tables** in migrations 001+; if such
tables are ever introduced they are demo/history artifacts and MUST NOT feed
these routes. These endpoints return governed rows exclusively (`source:
"OFFICIAL"` marker on records/awards payloads).

## 6. Transport limits and timeouts

Configured in `buildApp()` via Fastify:

- `BODY_LIMIT_BYTES` (default `1048576`): oversized requests are rejected by
  Fastify with HTTP 413 and the standard safe error envelope
  (`{error:{code:"VALIDATION_ERROR",...}}`) without leaking internals.
- `REQUEST_TIMEOUT_MS` (default `30000`): per-request server timeout so no
  request hangs indefinitely; ordinary database requests complete well within.

## 7. Health and readiness

- `GET /health` - static lightweight liveness (`{status:"ok",service:"nssms-api"}`).
- `GET /ready` - `200 {"status":"ready","database":"ok"}` when the database
  responds to `SELECT 1`, otherwise `503 {"status":"not_ready",
  "database":"unavailable"}`. No connection details are exposed. By design the
  readiness response uses this infrastructure shape instead of the normal
  authenticated error envelope; this is intentional and documented here.

## 8. Demo data isolation

- Backend startup never seeds anything. Migration tooling only applies schema.
- Demo/simulation datasets are created exclusively by explicit scripts
  (`npm run seed:demo`, `npm run seed:data`, `npm run seed:national-accounts`,
  `npm run seed:scoped-accounts`). There is no `seed:simulation` step, and pilot
  startup does not require it (proven by CI job `pilot-startup-no-seed` running
  against a fresh database with zero demo seeding).
- **NEVER RUN DEMO SEEDS ON PILOT OR PRODUCTION DATABASES.**

## 9. Session/revocation debt (explicitly not fixed)

Deliberately NOT implemented in this task (no new token revocation subsystem):

- Logout clears client-side state and writes an audit record only.
- Issued stateless bearer tokens remain valid until expiry (~8 hours) after
  logout, password change, or user disabling.

Classification:

- **HIGH** for public-internet deployment (requires token revocation/versioning
  before any public internet exposure).
- **NON-BLOCKING** for the closed controlled pilot operated by trusted users
  with short token lifetime.

## 10. Remaining known debt

- OpenAPI document drift continues; new public endpoints are intentionally not
  part of a generated contract yet.
- In-memory rate-limit store is single-instance.
- `403` vs `404` existence-revelation trade-off on admin direct-ID routes is
  consistent but revealing; revisit under API-wide review.
