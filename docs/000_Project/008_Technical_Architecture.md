# NSSMS — Technical Architecture

**Status:** PROPOSED foundation baseline; subject to approval of the open decisions in `007_Implementation_Readiness.md`.

## Implemented baseline

The repository now contains a TypeScript Fastify backend, React/Vite frontend, PostgreSQL SQL migrations, Vitest tests, and a checked-in OpenAPI baseline. Data access is explicit SQL through `pg`; no ORM is currently used.

## Decision

Use a modular TypeScript monorepo with a Fastify HTTP API, PostgreSQL, and a browser frontend that consumes the versioned API. Keep domain services independent from controllers and persistence details.

## Baseline stack

- **Runtime/language:** Node.js LTS and TypeScript with strict compiler settings.
- **API:** Fastify, `@fastify/helmet`, `@fastify/rate-limit`, and Zod for request validation.
- **Persistence:** PostgreSQL with checked-in SQL migrations and the `pg` driver. SQL is explicit and reviewable; an ORM can be evaluated after the logical model is approved.
- **Authentication:** Server-side session/JWT strategy is **TBD**; password hashes and user status are represented in the schema without embedding a policy.
- **Authorization:** database-backed roles and permissions, enforced in application services.
- **Observability:** structured Pino logging, request IDs, health/readiness endpoints, and audit events for sensitive operations.
- **Frontend:** React + TypeScript, RTL-first CSS and localization-ready message catalogs (**PROPOSED**, to be scaffolded after API contracts stabilize).
- **Testing:** Vitest for unit tests and an ephemeral PostgreSQL integration environment in CI (**PROPOSED**).
- **Build:** `tsc` for backend type-check/build and Vite for frontend production bundles.
- **Local development:** PostgreSQL plus `npm run dev` in each package; environment variables are documented in `.env.example`.
- **Production deployment:** **TBD** pending hosting, TLS, secrets, backup/recovery, and monitoring decisions.

## Boundaries

`backend/src` contains HTTP adapters, application services, domain policies, and infrastructure. `database/migrations` is the source-controlled physical schema. Public verification returns an allow-listed projection and never the participant's private record.

## Security baseline

Secrets come from environment/secret management, never source. SQL is parameterized. QR tokens are generated with cryptographic randomness and stored as hashes. Audit rows are append-only through a database trigger. Production TLS, MFA, password/session policy, key rotation, and rate-limit values remain OPEN DECISION.

## Evolution rules

Approved business decisions must be captured as migrations, tests, and documentation updates. No controller may bypass a domain service or authorization check. Governed records are archived/deactivated rather than deleted.
