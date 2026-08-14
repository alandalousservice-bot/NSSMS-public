# NSSMS database

The initial physical schema is PostgreSQL and lives in `migrations/001_initial_schema.sql`; integrity triggers are in `migrations/002_integrity_triggers.sql`.

## Initialize locally

1. Create a PostgreSQL database.
2. Set `DATABASE_URL` to a connection string supplied by your secret manager or local environment.
3. Apply the migration with `psql "$env:DATABASE_URL" -f database/migrations/001_initial_schema.sql` (PowerShell) or `psql "$DATABASE_URL" -f database/migrations/001_initial_schema.sql` (POSIX shell).

The migration is additive and safe to review before applying. No application workflow should issue DELETE against governed records; use status/archive fields.

Apply the second migration after the first:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" $env:DATABASE_URL -f database\migrations\002_integrity_triggers.sql
```
