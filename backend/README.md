# NSSMS Backend

Backend implementation directory.

The backend implements the approved foundation baseline while governance-sensitive production decisions remain explicitly tracked as open items.

Expected responsibilities:
- Authentication.
- Authorization.
- Business rules.
- Domain services.
- API.
- Validation.
- Audit.
- Reporting.

## Local development

```powershell
Copy-Item .env.example .env
npm install
npm run build
npm run dev
```

The API liveness check is available at `http://localhost:3000/health`; dependency readiness is available at `http://localhost:3000/ready`.

API metadata is available at `/api/v1`; the OpenAPI document is served at `/openapi.json`.

For a fresh database, use the migration runner from `backend` with `npm run migrate`; it records applied filenames in `schema_migrations` and runs them in order.

With `DATABASE_URL` set, run `npm run test:integration` to verify PostgreSQL tables and append-only audit behavior. Without it, the integration suite is explicitly skipped.

The migration runner is idempotent: after the first successful run, subsequent `npm run migrate` calls only inspect `schema_migrations` and apply new files.

Set `AUTH_SECRET` before using authentication. Login is available at `POST /api/v1/auth/login`; use the returned bearer token for `GET /api/v1/auth/me`.

Authentication applies a per-route limit of 10 login attempts per minute and a global API limit of 100 requests per minute. Production deployments should place the API behind TLS and a managed rate-limit store.

Authenticated users can change their password with `POST /api/v1/auth/change-password`; the current password is required and the operation is audited.

Public read-only endpoints include `GET /api/v1/public/seasons`, `/competitions`, `/results`, and the license verification endpoint. Browser access from the configured `FRONTEND_ORIGIN` is enabled for local development.

Protected administration endpoints now include:

- `GET/POST /api/v1/admin/organizations`
- `POST /api/v1/admin/organizations/:id/status`
- `GET/POST /api/v1/admin/institutions`
- `POST /api/v1/admin/institutions/:id/status`
- `GET/POST /api/v1/admin/participants`
- `POST /api/v1/admin/participants/:id/status`
- `PATCH /api/v1/admin/participants/:id`
- `PATCH /api/v1/admin/organizations/:id`
- `PATCH /api/v1/admin/institutions/:id`
- `PATCH /api/v1/admin/seasons/:id`
- `PATCH /api/v1/admin/competitions/:id`
- `PATCH /api/v1/admin/licenses/:id`
- `PATCH /api/v1/admin/results/:id`
- `POST /api/v1/admin/results/:id/status`
- `GET/POST /api/v1/admin/seasons`
- `POST /api/v1/admin/seasons/:id/transition`
- `GET/POST /api/v1/admin/competitions`
- `POST /api/v1/admin/competitions/:id/transition`
- `GET/POST /api/v1/admin/licenses`
- `GET /api/v1/admin/results`
- `POST /api/v1/admin/competitions/:id/results`
- `GET /api/v1/admin/audit`
- `GET /api/v1/admin/audit.csv`
- `GET /api/v1/admin/audit/:id`
- `GET /api/v1/admin/reports/summary`
- `GET /api/v1/admin/reports/status-breakdown`
- `GET /api/v1/admin/lookups`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `GET /api/v1/admin/roles`
- `GET /api/v1/admin/permissions`
- `GET /api/v1/admin/roles/:id/permissions`
- `PUT /api/v1/admin/roles/:id/permissions`
- `PUT /api/v1/admin/users/:id/roles`
- `POST /api/v1/admin/users/:id/status`
- `POST /api/v1/admin/{entity}/{id}/archive` for non-destructive archival of supported governed records.
- `GET /api/v1/admin/me/permissions`
- `POST /api/v1/admin/licenses/sync-expiry`

If PowerShell cannot find `psql`, use the installed PostgreSQL binary directly:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" $env:DATABASE_URL -f ..\database\migrations\001_initial_schema.sql
```

The migration only needs to be applied once for a new database. If `EADDRINUSE` is reported on port 3000, the API is already running; open `http://localhost:3000/health` instead of starting a second copy. To stop the existing development process, use `Stop-Process -Id <PID>` after checking `netstat -ano | findstr :3000`.

After applying the PostgreSQL migration, create development-only accounts with environment variables (never commit them):

```powershell
$env:DATABASE_URL = 'postgres://nssms:nssms@localhost:5432/nssms'
$env:DEMO_ADMIN_PASSWORD = 'replace-with-a-strong-local-password'
$env:DEMO_NATIONAL_PASSWORD = 'replace-with-another-strong-local-password'
npm run seed:demo
npm run seed:data
```

Scoped development accounts are created separately with `npm run seed:scoped-accounts`: `ASSOCIATION_ADMINISTRATOR`, `ASSOCIATION_REPRESENTATIVE`, `DAIRA_OFFICER`, and `MEMBER_INSTITUTION_USER`. Set the corresponding passwords (12+ characters), plus optional `WILAYA_ID`, `DAIRA_ID`, association/institution names and codes. Each account is linked to its organization; the daira officer is linked to one daira, and the institution account is linked to the enrolled institution.

To provision the complete local demo catalogue, run `npm run seed:national-accounts`. This creates or updates 58 wilaya association administrators, 548 daira supervisors, and one temporary institution account per daira (1,154 accounts total). Credentials are written to `backend/var-demo-accounts.csv`, which is ignored by Git. Institution names are placeholders until the authoritative institution/commune data is supplied; rerunning the command is safe and updates the same records.

The supplied Algerian geography archive is imported with `npm run import:geography` after migrations. It loads 58 wilayas and the archive's dairas into `wilayas` and `dairas`; the archive does not contain a separate commune dataset, so `communes` remains ready for a future authoritative municipality source.

Public geography endpoints: `GET /api/v1/public/geography/wilayas`, `GET /api/v1/public/geography/wilayas/:id/dairas`, and `GET /api/v1/public/geography/dairas/:id/communes`.

Institution onboarding uses `POST /api/v1/auth/institution-register` with `wilayaId`, `dairaId`, institution details, and credentials. The account is created as `PENDING`; the wilaya association administrator reviews it through `GET /api/v1/association/institution-registrations` and activates it with `POST /api/v1/association/institution-registrations/:userId/approve`. Approval is restricted to the same wilaya scope.
