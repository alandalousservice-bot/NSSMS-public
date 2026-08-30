# NSSMS Local Pilot UAT Checklist

Environment: `LOCAL PILOT / DEMO DATA`  
Backend: `http://localhost:3000`  
Frontend: `http://localhost:5173`

Use `demo.admin` for national administration and the scoped accounts listed
in the handoff report. Do not treat demo records as official Algerian data.

## Browser checklist

| Area | Starting screen | Action | Expected result |
|---|---|---|---|
| A. Authentication | Login | Sign in as `demo.admin` | Dashboard opens and session identity is shown |
| A. Authentication | Login | Enter an invalid password | Safe authentication error; no token or secret is shown |
| B. User administration | User administration | List users, create/edit a demo user, enable/disable it | Authorized changes succeed; password material is never listed |
| C. Roles/scopes | User administration | Inspect each scoped account and attempt an out-of-scope action | Scope is visible and forbidden actions remain forbidden |
| D. Competition administration | Competition administration | Open competition overview and select a competition | Name, season, status, and dates are displayed |
| E. Entries | Competition administration / Entries | Open entry list and inspect individual/team states | Entries and governed states are displayed with safe errors |
| F. Results/revisions/decisions | Competition administration / Results | Inspect current, official, and revision states | Official results cannot be edited directly; revisions remain traceable |
| G. Qualification | Competition administration / Qualification | Inspect evidence and qualification decisions | Evidence and decision status are visible |
| H. Rankings | Competition administration / Rankings | Inspect ranking inputs, rows, and current/superseded state | Current ranking semantics are clear |
| I. Awards | Competition administration / Awards | Inspect award lifecycle actions where data exists | Issue, revoke, and archive actions respect authorization and provenance |
| J. Public portal | Public portal | Browse seasons, competitions, results, awards, and records | Only governed public data is shown |
| J. Public portal | License verification | Open license verification with a supported reference | Valid reference verifies; unknown reference returns a safe not-found result |
| K. Responsive/navigation | Any authenticated screen | Resize below 800px and navigate between sections | RTL layout remains usable and tables become readable cards/rows |
| L. Logout/session | Any authenticated screen | Log out, then revisit an authenticated page | Client session is cleared and authenticated pages require login again |

## Defect format

```text
UAT-ID:
Screen:
Account:
Steps:
Expected:
Actual:
Severity suggestion:
Screenshot/log:
```

## Restart the local pilot

The pilot database is persistent at `nssms_pilot_local` on the dedicated local
PostgreSQL instance at port `55433`. Start that PostgreSQL instance first:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" `
  -D "C:\Users\ous\AppData\Local\NSSMS\pilot-postgres-20260830" `
  -l "C:\Users\ous\AppData\Local\NSSMS\pilot-postgres.log" `
  -o "-p 55433" start
```

Then set the pilot environment and run `scripts/start-local.ps1` from the
repository root:

```powershell
$env:DATABASE_URL = "postgres://nssms@localhost:55433/nssms_pilot_local"
$env:AUTH_SECRET = "<the local pilot secret established for this environment>"
$env:PILOT_ADMIN_PASSWORD = "<set locally>"
$env:PILOT_INSTITUTION_PASSWORD = "<set locally>"
$env:FRONTEND_ORIGIN = "http://localhost:5173"
./scripts/start-local.ps1
```

The script reapplies migrations idempotently and starts the backend and
frontend in separate PowerShell windows. Verify `http://localhost:3000/health`,
`http://localhost:3000/ready`, and `http://localhost:5173` before testing.
