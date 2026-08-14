# NSSMS Repository Review

**Review date:** 2026-08-14  
**Scope:** Read-only review of the repository at `D:\rabiita\NSSMS`.  
**Change policy followed:** This review creates only this file; no existing source, documentation, database, configuration, or test file was modified.

## Executive summary

NSSMS is a work-in-progress national school sports management platform for Algeria. The repository has a coherent modular baseline: a Fastify/TypeScript API, PostgreSQL migrations, a React/Vite public portal, role-aware dashboard scaffolding, lifecycle rules, QR/license verification, audit logging, and local development scripts.

The implementation is suitable for continued development and local demonstrations, but it is not production-ready. The most important blockers are:

1. Authorization is inconsistent: many authenticated read endpoints do not enforce permissions or organization/daira/institution scope, while scoped dashboard calculations are narrower.
2. The OpenAPI document is materially behind the implemented routes, including institution registration, approval, dashboard, CRUD, and newer role/geography features.
3. The geography importer depends on an ignored local archive path, so a clean clone cannot reproduce the 58-wilaya/548-daira dataset without separately restoring that archive. The supplied archive has no communes dataset.
4. Demo credentials are deterministic and embedded in a committed seed script. This is acceptable only for isolated local demos and must never be used in a deployment.
5. The frontend is a public/read-only portal plus a very small role summary dashboard; registration, association approval, institution management, daira workflows, and most administrative CRUD screens are absent.
6. Arabic content is visibly mojibake in several committed files, indicating an encoding/charset handling problem.

The repository has a strong foundation and test coverage for the implemented baseline, but the remaining work is primarily production hardening, complete scoped authorization, UI completion, and deployment/reproducibility.

## 1. Current architecture

### Logical architecture

The system follows a conventional modular monorepo shape:

```text
React/Vite browser UI
        |
        | HTTP/JSON, bearer token, CORS
        v
Fastify TypeScript API
  - auth/session handling
  - route handlers and validation
  - lifecycle/domain rules
  - verification service
  - authorization helpers
        |
        v
PostgreSQL
  - relational business schema
  - role/permission tables
  - append-only audit log
  - migration runner
```

The API is a single Fastify application assembled in `backend/src/app.ts`, with administration routes registered from `backend/src/routes/admin.ts`. Authentication and bearer-token signing live in `backend/src/services/auth.ts`; request authentication and permission lookup are in `backend/src/http/auth-guard.ts`; lifecycle transitions are isolated in `backend/src/domain/lifecycle.ts`; QR/license reference hashing is in `backend/src/services/verification.ts`.

The frontend is intentionally lightweight. `frontend/src/main.tsx` contains the public shell, navigation, public listings, license verification view, and entry to the administration view. `frontend/src/RoleAdmin.tsx` provides generic login and a role/scope summary dashboard rather than a complete administration application.

### Architectural strengths

- Clear separation between UI, API routes, domain transition rules, authentication, and persistence.
- PostgreSQL is the source of truth for governed records and status transitions.
- Non-destructive lifecycle fields (`status`, `archived_at`) are used instead of hard deletion for core records.
- Audit records have a database trigger that rejects update/delete operations.
- Public verification returns a hashed-reference lookup result rather than exposing the internal QR reference hash.
- Migrations are additive and tracked through `schema_migrations`.

### Architectural limitations

- There is no service/repository layer around most CRUD operations; substantial business logic and SQL are embedded directly in route handlers.
- `app.ts` and especially `routes/admin.ts` are very dense, with many one-line handlers. This reduces reviewability, testability, and maintainability.
- There is no background job/queue boundary for expiry synchronization, notifications, imports, or high-volume result processing.
- No explicit deployment boundary exists for secrets, TLS termination, metrics, tracing, backups, or external rate-limit storage.

## 2. Folder structure

```text
NSSMS/
├── backend/
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config.ts
│   │   ├── domain/lifecycle.ts
│   │   ├── http/auth-guard.ts
│   │   ├── infrastructure/db.ts
│   │   ├── routes/admin.ts
│   │   └── services/{auth,verification}.ts
│   ├── scripts/
│   ├── tests/
│   ├── openapi.json
│   ├── package.json
│   └── README.md
├── database/
│   ├── migrations/001..008_*.sql
│   ├── README.md
│   └── migrations/README.md
├── frontend/
│   ├── src/{main,RoleAdmin}.tsx
│   ├── styles.css
│   ├── package.json
│   └── README.md
├── docs/
│   ├── 000_Project/
│   ├── 001_Business/
│   ├── 002_System/
│   ├── 003_UI/
│   ├── 004_Database/
│   └── 005_Presentation/
├── scripts/{start-local,stop-local}.ps1
├── README.md
├── CHANGELOG.md
└── .gitignore
```

There is also an ignored `_incoming_geography_20260814/` directory containing the supplied Laravel geography archive. It is an input artifact, not a reproducible repository dependency.

## 3. Technologies used

### Backend

- Node.js, TypeScript, ESM.
- Fastify 5.
- PostgreSQL via `pg`.
- Zod for request validation.
- `@fastify/cors`, `@fastify/helmet`, and `@fastify/rate-limit`.
- Node `crypto` for scrypt password hashing, HMAC session signing, random verification references, and SHA-256 reference hashing.
- Vitest for unit, HTTP, artifact, and PostgreSQL integration tests.

### Frontend

- React 18.
- Vite 6.
- TypeScript.
- `lucide-react` icons.
- CSS with a Cairo Google Fonts import and RTL layout styling.

### Database and tooling

- PostgreSQL with `pgcrypto`, UUIDs, enums, foreign keys, indexes, triggers, JSONB, and timestamp lifecycle columns.
- Ordered SQL migrations tracked in `schema_migrations`.
- PowerShell local start/stop scripts.
- Laravel package archive used as a one-time source for wilaya/daira data.

## 4. Coding standards and observed conventions

### Existing conventions

- TypeScript source uses ESM imports with `.js` extensions.
- SQL uses snake_case column names and parameterized queries.
- API payloads generally use `{ data: ... }` for administrative collections and explicit `{ error: ... }` responses for failures.
- Zod schemas validate most write payloads and route parameters.
- Migrations use additive `IF NOT EXISTS`/upsert patterns where practical.
- Tests use Vitest and Fastify `inject()` for HTTP behavior.
- PowerShell is the documented local workflow on Windows.

### Standards concerns

- Several production files are compressed into single-line statements, especially `routes/admin.ts`, `app.ts`, and frontend components. This is inconsistent with maintainable TypeScript style and makes code review difficult.
- There is no visible ESLint, Prettier, commit hook, or CI workflow enforcing formatting, type safety, linting, or dependency/security checks.
- Many values are typed as `any`, especially request bodies and frontend response models.
- Error types are frequently cast ad hoc rather than modeled centrally.
- Arabic strings appear mojibaked in source and documentation; encoding should be standardized to UTF-8 and verified in CI.

## 5. Existing modules and implemented capabilities

### Identity and access

- Username/password login.
- HMAC-signed, eight-hour bearer sessions.
- `/auth/me`, logout, and password change.
- System, national, association, representative, daira officer, institution, and public roles in migrations.
- Role-permission tables and permission lookup helper.
- Wilaya, daira, organization, and institution scope fields on users/organizations.
- Institution registration with `PENDING` status and association approval endpoints.

### Governance and lifecycle

- Season, competition, license, and record status enums.
- Centralized allowed transition maps for seasons, competitions, and licenses.
- Non-destructive archive endpoints for supported records.
- Expired-license synchronization endpoint.

### Sports operations

- Organizations and educational institutions.
- Participants.
- Seasons and competitions.
- Sports licenses and status transitions.
- Results attached to competitions and optionally participants.

### Public services

- Public seasons, competitions, results listings.
- License verification by opaque reference.
- Public wilaya/daira/commune lookup endpoints.

### Audit and reporting

- Audit insertion for many authenticated mutations.
- Append-only database trigger.
- Audit filtering, detail, CSV export, summary report, and status breakdown.
- Role-aware dashboard summary with national, organization, daira, and institution scopes.

### Data/import and demo tooling

- Demo account seeding.
- Scoped account seeding.
- Bulk national demo account generation for 58 wilayas and 548 dairas.
- Laravel seeder parsing/import for wilayas and dairas.
- Local start/stop scripts.

## 6. Missing modules

The following modules are absent or only represented by documentation/scaffolding:

- Complete association administration portal.
- Institution registration and approval UI.
- Daira officer UI and workflow controls.
- Institution user participant-management UI.
- Full organization/institution/participant/season/competition/license/result CRUD UI.
- Commune import and authoritative municipality dataset.
- Institution verification/document review workflow.
- Notification/email/SMS module.
- Password reset, email verification, MFA, and account recovery.
- Competition scheduling, venues, teams, fixtures, officials, and event logistics.
- Bulk CSV import/export for institutions and participants beyond audit export.
- File/document storage and attachment scanning.
- Operational observability: metrics, tracing, structured security events, and alerting.
- Backup/restore automation and disaster-recovery tooling.
- CI/CD, environment promotion, container/orchestration manifests, and production deployment configuration.

## 7. Incomplete features and requirement gaps

- Scoped dashboard counts exist, but most administrative CRUD routes still authorize by broad role or only by authentication. Association/daira/institution row-level scope is not consistently applied.
- Association administrators can approve institution registrations through the API, but there is no frontend queue or review screen.
- The institution registration API creates or upserts the institution record, but there is no institution profile verification process, approval reason, reviewer identity field, or explicit rejection endpoint.
- The frontend has only summary cards for a logged-in user. It does not expose the documented administrative modules, tables, filters, edit forms, transitions, or audit views.
- The supplied geography archive provides 58 wilayas and 548 dairas, but no commune records. The `communes` table is present but empty until an authoritative source is supplied.
- OpenAPI documents only a subset of routes. Newly implemented auth registration, approval, dashboard, scoped geography/account behaviors, PATCH/status routes, and several admin endpoints are absent.
- Public listing endpoints return simple arrays and do not provide a complete public publication/versioning model.
- The migration/documentation wording still contains older manual `psql` steps that do not describe all eight migrations and the importer as clearly as the backend migration runner does.

## 8. Technical debt

### High priority

- Route-level authorization and row-level scope enforcement are duplicated inconsistently and should be centralized in policy/query helpers.
- `app.ts` and `routes/admin.ts` need decomposition into bounded route modules and application services.
- OpenAPI should be generated or contract-tested against the actual route schemas.
- Geography input data must be versioned, vendored as an explicit data artifact, or imported from a configurable source with checksums.
- Demo credentials must be generated at runtime from environment input and never be embedded as deterministic production-like passwords.

### Medium priority

- Add typed DTOs/response schemas and remove avoidable `any` usage.
- Add pagination consistently to administrative collection endpoints.
- Add database constraints for geography consistency and institution scope.
- Add centralized error codes, request correlation, and consistent audit metadata.
- Add CI checks for typecheck, build, tests, formatting, dependency audit, OpenAPI drift, and UTF-8 validity.

### Low priority

- Improve component decomposition and state management in the frontend.
- Replace repeated inline Arabic strings with localization resources.
- Add design tokens and reusable table/form/modal components.
- Remove unused helper code such as the unused `clean` function in the bulk account seed script.

## 9. Bugs and correctness risks

### Confirmed or directly observable

1. **Character encoding corruption:** Arabic strings are stored/displayed as sequences such as `Ø§Ù„...` in README, frontend, and seed source. This is a user-visible correctness defect and may also affect imported names.
2. **OpenAPI drift:** the served/static OpenAPI document does not describe a large portion of the implemented API, so generated clients and external integrators receive an incomplete contract.
3. **Non-reproducible geography import:** `import-geography.mjs` resolves a hardcoded `_incoming_geography_20260814/...` path that is ignored and absent from a clean clone. A new checkout cannot run the documented import without manually restoring the archive.
4. **Migration baseline risk:** `migrate.mjs` marks `001_initial_schema.sql` as applied whenever a `users` table already exists. A partially initialized database can therefore skip the complete baseline migration and fail later in less obvious ways.
5. **Geographic relationship integrity:** `communes` stores both `daira_id` and `wilaya_id` without a composite foreign key ensuring that the daira belongs to the same wilaya. Institution `commune_id` and `daira_id` likewise have no database-level consistency constraint.
6. **Registration upsert semantics:** institution registration uses `ON CONFLICT (organization_id, code) DO UPDATE`, which lets a new registration change an existing institution's name/daira before approval. This should be replaced with explicit duplicate handling and reviewable changes.

### Likely operational issues

- The local backend reports `EADDRINUSE` when another development process already owns port 3000; the scripts document this but do not automatically detect/reuse the existing service.
- The bulk national seed performs more than one thousand sequential password-hash/database operations, making reruns slow and increasing the chance of an interrupted partial seed.
- Several route handlers depend on database rows and return generic 500 responses for unexpected constraint failures; user-facing conflict/error classification is incomplete.
- Most collection endpoints have no pagination or server-side result limits, which will become a performance issue with national-scale data.

## 10. Security review

### Positive controls

- Passwords are hashed with scrypt and random salts.
- SQL uses parameterized values for user input; dynamic archive tables are restricted by a Zod enum.
- Helmet, CORS, and rate limiting are enabled.
- Login and sensitive mutations are audited.
- Audit logs are database-protected against update/delete.
- Public license verification does not reveal the internal reference hash or license ID.
- Pending institution users cannot log in because login requires `ACTIVE` status.

### High-risk findings

1. **Deterministic demo passwords in committed source:** `seed-national-accounts.mjs` contains predictable passwords for all generated accounts. The script and accounts must be strictly development-only; production seeding must require externally supplied secrets or generated one-time credentials.
2. **Incomplete authorization:** many authenticated GET routes under `/api/v1/admin` do not require a role or permission. A valid institution/daira user can potentially read national collections such as participants, licenses, results, lookups, seasons, and competitions. Scope and permission checks must be applied to every route and query.
3. **Stateless logout:** logout only writes an audit event. Previously issued bearer tokens remain valid until expiry. Password changes also do not invalidate existing sessions.
4. **No MFA or recovery controls:** there is no MFA, email verification, password reset, device/session management, account lockout policy, or breached-password detection.
5. **Development secret fallback:** `config.ts` uses a development fallback `AUTH_SECRET` when the environment is unset. A production startup guard exists, but deployment configuration must fail closed in every non-development environment.
6. **In-memory rate limit:** the default rate-limit store is process-local; it is not suitable for multiple API instances or coordinated brute-force protection.

### Additional security gaps

- TLS, reverse-proxy hardening, secure headers policy, secret rotation, and database least-privilege roles are deployment responsibilities but are not supplied in the repository.
- No explicit request body size limits, upload policy, or abuse monitoring are defined.
- Audit metadata and error logging need a review to prevent accidental inclusion of sensitive identifiers or operational secrets.
- Institution approval has no explicit rejection/appeal reason and no persisted `approved_by`/`approved_at` fields on the account or institution record.

## 11. Database review

### Strengths

- UUID primary keys and foreign keys are used consistently for core entities.
- Status enums encode lifecycle states.
- Date/check constraints protect season, competition, and license validity ranges.
- Indexes cover major foreign-key/status lookup paths and audit access.
- Audit immutability is enforced in the database, not only in application code.
- Migration 005–008 extend the original model without deleting existing columns/features.

### Gaps and risks

- No database-level tenant/scope policy (for example PostgreSQL RLS) backs the application authorization model.
- `users` has no `approved_by`, `approved_at`, `rejected_at`, or review reason fields for institution onboarding.
- Organization and institution status are not automatically synchronized with user access.
- There is no uniqueness strategy for institution codes across the authoritative geography model beyond organization-local uniqueness.
- Geography tables do not include a source/version/import checksum or an explicit data quality status.
- The initial schema and later migrations are not represented by generated types or schema validation in CI.
- There is no backup, retention, partitioning, or archival strategy for the growing audit log.
- The database pool configuration is minimal; production pool size, timeouts, SSL, statement timeout, and retry behavior are unspecified.

## 12. API review

### Implemented API domains

- Health/readiness and API metadata.
- Login, logout, session lookup, password change.
- Institution registration and association approval.
- Scoped dashboard summary.
- Public seasons, competitions, results, geography, and license verification.
- Administrative organizations, institutions, participants, seasons, competitions, licenses, results, users, roles, permissions, audit, reports, lookups, and archive/sync actions.

### API strengths

- Input validation is generally explicit through Zod.
- Status codes are reasonably differentiated for validation, authentication, authorization, conflict, and not-found cases.
- Public verification is cache-disabled.
- Audit and authorization helpers are reusable in several routes.

### API weaknesses

- Route authorization policy is not uniform; authentication-only routes expose data beyond the caller's scope.
- OpenAPI is manually maintained and substantially stale.
- Response schemas are not declared or validated at the framework boundary.
- Error response shape is inconsistent (`error`, optional `message`, optional `details`).
- No versioning strategy beyond the `/api/v1` prefix is documented.
- No idempotency keys exist for important mutations such as registration, license issuance, or result submission.
- No API pagination contract, filtering standard, sorting standard, or maximum response policy is shared across modules.
- No documented concurrency/optimistic-locking behavior exists for status transitions or approvals.

## 13. UI review

### Existing UI

- RTL public portal shell with home, seasons, competitions, results, license verification, and administration entry.
- Responsive CSS for desktop/mobile layouts.
- Generic login form accepting any username/password rather than a hardcoded demo account.
- Role-aware summary cards for national, association, daira, and institution scopes.

### UI strengths

- Clear separation between public verification and authenticated administration entry.
- Basic responsive layout and reusable visual styles.
- The frontend build succeeds with the current source.

### UI gaps and defects

- No institution registration form or pending-approval queue.
- No association management workspace for wilaya-wide competitions and institutions.
- No daira supervisor workspace.
- No participant, competition, season, license, result, audit, role, or permission management screens.
- No loading/error/empty-state model beyond simple fallback messages in several listings.
- API response types are untyped (`any`) and failures are often swallowed into empty arrays.
- No accessible form error association, keyboard/focus model, or automated accessibility checks.
- No localization framework; Arabic text is embedded directly and is currently mojibaked in source.
- No session expiry handling, logout control, token refresh/re-authentication UX, or pending-account status message.
- Several CSS classes are prepared but unused, suggesting the UI was started from a broader design concept and is not yet complete.

## 14. Testing and validation observed

The repository contains six Vitest suites covering HTTP foundation, artifact checks, lifecycle transitions, verification, PostgreSQL integration, and a core workflow. The last observed run passed:

- **6 test files passed**
- **26 tests passed**
- Backend TypeScript build passed.
- Frontend Vite build passed.

The tests validate the current baseline, but they do not yet cover the highest-risk gaps: cross-scope authorization, institution registration rejection/approval edge cases, token revocation, OpenAPI route parity, commune/geography consistency, frontend behavior, accessibility, load behavior, or security regression cases.

## 15. Recommended implementation order

1. Fix UTF-8/Arabic encoding and add a repository encoding check.
2. Make geography import reproducible by committing a versioned, licensed data artifact or providing a configurable external source and checksum.
3. Define and centralize authorization policies for national, wilaya association, daira, and institution scopes; apply them to every read and write route.
4. Add approval/rejection audit fields and immutable review history for institution onboarding.
5. Remove deterministic production-like credentials from committed scripts; require environment-provided secrets or generated one-time credentials.
6. Regenerate/expand OpenAPI from the actual route contracts and add a route-parity test.
7. Decompose dense route files into bounded modules/services and add typed DTOs/response schemas.
8. Build the association, daira, and institution UI workflows, starting with registration approval and scoped participant management.
9. Add session revocation/rotation, MFA/recovery roadmap, distributed rate limiting, and deployment security configuration.
10. Add CI/CD, database backup/restore checks, performance tests, accessibility tests, and production observability.

## Final assessment

NSSMS has a credible implementation foundation and preserves the intended governance/lifecycle philosophy. It is appropriate for local development, demos, and continued feature work. It should be classified as **WIP / pre-production**, not as a production launch candidate, until authorization scope enforcement, data reproducibility, credential handling, API contract parity, and the missing operational/UI modules are addressed.
