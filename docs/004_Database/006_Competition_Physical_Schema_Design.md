# NSSMS Competition Physical Schema Design & Migration Plan

**Status:** Physical design analysis only — approval required  
**Task:** `NSSMS-ARCH-005`  
**Database:** PostgreSQL  
**Scope:** No executable migrations, SQL execution, running-database changes, backend/frontend changes, or API implementation.

## 1. Design basis

This design translates the approved logical model in `005_Competition_Domain_Logical_Model.md`, the versioned-regulations ADR, ARCH-002 evidence, the current PostgreSQL schema, and ARCH-001 authorization behavior. It preserves existing `seasons`, `competitions`, `participants`, `results`, licenses, institutions, organizations, and audit records.

Regulations are versioned configuration, not hard-coded global business rules. Published versions are immutable; historical outcomes retain their exact regulation/provenance context. Concrete DDL below is illustrative, non-executable notation only.

## 2. PostgreSQL conventions

- Existing UUID identity strategy is retained (`uuid` with server-generated defaults where appropriate).
- Times use `timestamptz`; dates use `date`; measured values use `numeric` with an explicit unit/rule reference.
- Lifecycle values use controlled text/check constraints or lookup tables, not irreversible season-specific enums.
- Foreign keys default to `ON DELETE RESTRICT` and `ON UPDATE RESTRICT` for governed records. Reference cleanup uses `ON DELETE SET NULL` only for genuinely optional metadata.
- Every governed table has `created_at timestamptz NOT NULL`, `updated_at timestamptz NOT NULL`, and where applicable `archived_at timestamptz NULL`.
- Actor, scope, and provenance changes are recorded through the existing audit mechanism plus domain history tables.

## 3. Physical table catalogue

The tables below are proposed physical representations. `uuid` columns are abbreviated as `id uuid`; all foreign keys are indexed or covered by a composite index.

### 3.1 Regulation and programme configuration

| Table | Columns/types and nullability | Constraints/indexes | History/scope/audit |
|---|---|---|---|
| `competition_programmes` | `id uuid PK`, `season_id uuid NOT NULL`, `code text NOT NULL`, `title text NOT NULL`, `status text NOT NULL`, `effective_from date NOT NULL`, `effective_to date NULL`, timestamps, `archived_at` | FK season RESTRICT; unique `(season_id, code)`; check date order/status; index `(season_id,status)` | Programme identity exists independently; published rows immutable; national/programme scope; lifecycle audited. |
| `regulation_versions` | `id uuid PK`, `version_no text NOT NULL`, `parent_id uuid NULL`, `programme_id uuid NULL`, scope columns (`season_id`, `sport_id`, `event_id`, `category_id`, `stage_level text`) nullable, `effective_period daterange NOT NULL`, `status text NOT NULL`, `source_summary text`, timestamps | Self-FK and optional programme FK RESTRICT; unique version identity; active-overlap exclusion/activation validation; GiST/range index | `DRAFT→APPROVED→ACTIVE→RETIRED`; programme may have 1:N versions; no mutual NOT NULL cycle. |
| `regulation_rules` | `id uuid PK`, `regulation_version_id uuid NOT NULL`, `rule_key text NOT NULL`, `value_type text NOT NULL`, typed scalar columns (`value_text`, `value_numeric`, `value_date`, `value_bool`), `value_jsonb jsonb NULL` only for structured formula metadata, `unit text NULL`, `precedence smallint NOT NULL` | FK RESTRICT; unique `(regulation_version_id,rule_key)`; check exactly one typed value representation; index `(rule_key,regulation_version_id)` | Only draft versions writable; rule changes create new version; audit value resolution/override. |
| `regulation_sources` | `id uuid PK`, `regulation_version_id uuid NOT NULL`, `title text NOT NULL`, `issuer text NOT NULL`, `document_identifier text NULL`, `issued_on date NULL`, `page_section text NULL`, `sha256 text NULL`, `archive_uri text NULL`, timestamps | FK RESTRICT; unique `(regulation_version_id,sha256)` where hash present; index issuer/date | Immutable provenance; access audited; source files retained by approved archive policy. |
| `programme_regions` | `id uuid PK`, `programme_id uuid NOT NULL`, `regulation_version_id uuid NOT NULL`, `code text NOT NULL`, `name text NOT NULL`, `effective_period daterange NOT NULL`, `status text NOT NULL`, timestamps | FK RESTRICT; unique normalized `(programme_id,code,effective_period)`; no overlapping active identity for same code; GiST period index | Historical region identity retained; national/programme scope. |
| `region_memberships` | `id uuid PK`, `programme_region_id uuid NOT NULL`, `wilaya_id smallint NOT NULL`, `regulation_version_id uuid NOT NULL`, `effective_period daterange NOT NULL`, timestamps | FK region/regulation RESTRICT and geography FK to `wilayas(smallint)`; normalized scope key plus exclusion/activation validation prevents a wilaya in two active regions | Never retroactively rewrite static geography; boundary changes append new membership version; audit. |
| `sports` | `id uuid PK`, `code text NOT NULL`, `name text NOT NULL`, `sport_type text NOT NULL`, `status text NOT NULL`, timestamps | Unique code; check status/type; index status | Vocabulary changes are versioned/retired, not destructive renames. |
| `events` | `id uuid PK`, `sport_id uuid NOT NULL`, `code text NOT NULL`, `name text NOT NULL`, `format text NOT NULL`, `measurement_type text NULL`, `status text NOT NULL`, timestamps | FK RESTRICT; unique `(sport_id,code)`; index `(sport_id,status)` | Technical meaning governed by rule binding; retire rather than mutate. |
| `categories` | `id uuid PK`, `programme_id uuid NULL`, `code text NOT NULL`, `name text NOT NULL`, `gender_code text NOT NULL`, `education_level text NULL`, `regulation_version_id uuid NOT NULL`, timestamps | FK RESTRICT; use `NULLS NOT DISTINCT` where supported or a normalized programme-scope key before applying uniqueness; explicit gender/category checks | Birth-year/weight rules live in regulation rules; no global age default. |
| `event_rule_bindings` | `id uuid PK`, `event_id uuid NOT NULL`, `category_id uuid NULL`, `stage_level text NULL`, `regulation_version_id uuid NOT NULL`, `precedence smallint NOT NULL`, `effective_period daterange NOT NULL`, timestamps | FK RESTRICT; unique effective binding per event/category/stage/rule scope; GiST period index | Resolution traceable; conflicting active bindings rejected before activation. |

### 3.2 Competition operations

| Table | Columns/types and nullability | Constraints/indexes | History/scope/audit |
|---|---|---|---|
| `competition_stages` | `id uuid PK`, `competition_id uuid NOT NULL`, `parent_stage_id uuid NULL`, `programme_id uuid NOT NULL`, `programme_region_id uuid NULL`, `regulation_version_id uuid NOT NULL`, `stage_level_code text NOT NULL`, `status text NOT NULL`, `host_wilaya_id smallint NULL`, `host_daira_id integer NULL`, `host_commune_id integer NULL`, `host_organization_id uuid NULL`, start/end dates, timestamps, `archived_at` | Self-FK RESTRICT; region FK plus geography FKs use existing `wilayas.id smallint`, `dairas.id integer`, `communes.id integer`; check no self-parent/date order; indexes hierarchy/status/geography | Level is data-driven text/reference, not irreversible enum. Commune/region fields are data/provenance only until authorization decision. |
| `calendar_occurrences` | `id uuid PK`, `stage_id uuid NOT NULL`, `event_id uuid NOT NULL`, `category_id uuid NULL`, `regulation_version_id uuid NOT NULL`, registration/start/end timestamps, `status text NOT NULL`, source reference, timestamps | FK RESTRICT; unique `(stage_id,event_id,category_id,start_at)`; index date/status and stage/date | Published dates immutable; corrections create a new occurrence/version. |
| `venues` | `id uuid PK`, `code text NOT NULL`, `name text NOT NULL`, `wilaya_id smallint NULL`, `daira_id integer NULL`, `commune_id integer NULL`, address text NULL, `status text NOT NULL`, technical_attributes jsonb NULL, timestamps | FKs use existing geography key types; unique code; indexes geography/status; JSONB only for variable facility attributes | Retire/archive, do not delete venues used historically; inspections optional and audited. |
| `occurrence_venues` | `id uuid PK`, `calendar_occurrence_id uuid NOT NULL`, `venue_id uuid NOT NULL`, start/end timestamps, `role text NULL`, timestamps | FKs RESTRICT; unique `(calendar_occurrence_id,venue_id,start_at)`; exclusion concept prevents same venue overlap where required | Supports N:M stage/event/time venue allocation; assignment history retained. |
| `competition_entries` | `id uuid PK`, `stage_id uuid NOT NULL`, `category_id uuid NOT NULL`, `institution_id uuid NULL`, `representing_organization_id uuid NULL`, `entry_type text NOT NULL`, `status text NOT NULL`, `regulation_version_id uuid NOT NULL`, eligibility_data jsonb NULL, timestamps, `archived_at` | FKs RESTRICT; check institution/organization ownership; unique active subject/category/stage through subtype constraints; indexes stage/status/category/scope | Common governed record; JSONB only for submitted evidence metadata, not identity or qualification. |
| `individual_entries` | `competition_entry_id uuid PK/FK`, `participant_id uuid NOT NULL`, duplicated immutable `stage_id uuid NOT NULL`, `category_id uuid NOT NULL`, `participation_state text NOT NULL`, timestamps | Ordinary partial unique index `(stage_id,category_id,participant_id)` predicates on the duplicated subtype `participation_state`, not the parent table; deferred trigger synchronizes it with parent `competition_entries.status` and rejects mismatch | Exactly one subtype; subtype row immutable after validation. |
| `team_entries` | `competition_entry_id uuid PK/FK`, `team_id uuid NOT NULL`, duplicated immutable `stage_id uuid NOT NULL`, `category_id uuid NOT NULL`, `participation_state text NOT NULL`, timestamps | Ordinary partial unique index `(stage_id,category_id,team_id)` predicates on duplicated subtype state; deferred trigger synchronizes it with parent status and rejects mismatch | Exactly one subtype; team identity/history retained. |
| `teams` | `id uuid PK`, `institution_id uuid NULL`, `representing_organization_id uuid NULL`, `name text NOT NULL`, `category_id uuid NOT NULL`, `stage_id uuid NULL`, `status text NOT NULL`, timestamps | Ownership check; unique name within stage/category/owner; indexes scope/status | Team lifecycle and membership changes audited; no hard delete after entry/result. |
| `team_members` | `id uuid PK`, `team_id uuid NOT NULL`, `participant_id uuid NOT NULL`, `role text NOT NULL`, valid_from/to timestamptz, timestamps | FK RESTRICT; unique active `(team,participant)`; check interval/role | Substitution/reserve history append-only; role values resolved from regulation. |
| `delegations` | `id uuid PK`, `stage_id uuid NOT NULL`, representing institution/organization, `head_person_id uuid NULL`, `status text NOT NULL`, timestamps | FKs RESTRICT; unique delegation per stage/representing owner; indexes stage/scope | Composition governed by sport/stage rules; audit approval/closure. |
| `delegation_members` | `id uuid PK`, `delegation_id uuid NOT NULL`, `person_id uuid NOT NULL`, `role text NOT NULL`, valid interval, timestamps | FK to proposed `people` RESTRICT; unique active person/role/delegation; interval checks | Coaches/heads/officials retained historically; scope follows delegation stage. |
| `people` (proposed) | `id uuid PK`, legal/display identity, contact/identity attributes, optional `user_id uuid NULL`, optional `participant_id uuid NULL`, status, timestamps | Optional FKs to existing user/participant tables; unique external identity where available; no login required | Separates operational person from athlete and account. Retained/archived and audited. |
| `competition_officials` | `id uuid PK`, `person_id uuid NOT NULL`, `official_type text NOT NULL`, accreditation_reference text NULL, valid period, status, timestamps | FK to `people` RESTRICT; unique person/type/valid period; indexes type/status | Accreditation evidence and retirement audited. |
| `official_assignments` | `id uuid PK`, `official_id uuid NOT NULL`, `stage_id uuid NOT NULL`, `occurrence_id uuid NULL`, function text NOT NULL, assigned interval, status, timestamps | FKs RESTRICT; uniqueness for official/function/time; index stage/occurrence/status | Assignment and sign-off audit; no unauthorized result validation. |
| `stage_venues` | Optional stage-level association when a stage uses venues independent of event occurrences: `id uuid PK`, `stage_id uuid NOT NULL`, `venue_id uuid NOT NULL`, interval, role | FKs RESTRICT; unique stage/venue/interval; overlap checks where operationally required | Use alongside occurrence venues only when stage-wide hosting data is needed. |

### 3.3 Results, decisions, and history

| Table | Columns/types and nullability | Constraints/indexes | History/scope/audit |
|---|---|---|---|
| `qualifications` | `id uuid PK`, `source_entry_id uuid NOT NULL`, `destination_stage_id uuid NOT NULL`, destination entry NULL, `decision_rule_version_id uuid NOT NULL`, decision/status/reason, timestamps | Exactly one authoritative source is required: `source_entry_id`; FK RESTRICT; unique active source/destination/category | Immutable decision; supersede/correct, never delete; scope from source/destination. |
| `qualification_evidence` (optional) | `id uuid PK`, `qualification_id uuid NOT NULL`, `result_id uuid NULL`, `ranking_id uuid NULL`, evidence_type, evidence_hash, timestamps | At least one evidence FK per row; deferred trigger prevents empty evidence; multiple evidence rows allowed without ambiguity | Evidence is append-only; authoritative source remains `source_entry_id`. |
| `results` (evolution) | Preserve existing columns/PK and `result_data jsonb`; add nullable transition FKs `stage_id`, `occurrence_id`, `entry_id`, `event_id`, `category_id`, `regulation_version_id`, `provenance_source_id`; status, `validated_at`, timestamps | Existing FKs preserved; new FKs initially nullable/restrict; indexes new FKs/status; unresolved partial index where context incomplete | Existing Competition/Participant semantics remain; no destructive rewrite; official rows require complete context after final phase. |
| `result_revisions` | `id uuid PK`, `result_id uuid NOT NULL`, revision_no int, prior_snapshot jsonb NOT NULL, new_snapshot jsonb NOT NULL, reason, actor_id, created_at | Unique `(result_id,revision_no)`; FK RESTRICT; index result/time | Append-only correction history; snapshots preserve legacy JSON without loss. |
| `result_validations` | `id uuid PK`, `result_id uuid NOT NULL`, validator_id uuid NOT NULL, decision text NOT NULL, rule_version_id uuid NULL, notes, decided_at | FK RESTRICT; unique result/decision sequence; index result/status | Validation events immutable and audited. |
| `rankings` | `id uuid PK`, normalized scope key for nullable stage/event/category dimensions, `regulation_version_id uuid NOT NULL`, calculation_version text NOT NULL, status, published_at, metadata jsonb NULL, timestamps | Unique published normalized scope key + regulation/calculation version; do not rely on ordinary NULL-sensitive UNIQUE; indexes publication/scope | Published ranking immutable; metadata JSONB only for algorithm diagnostics. |
| `ranking_inputs` | `id uuid PK`, `ranking_id uuid NOT NULL`, `result_id uuid NOT NULL`, `input_hash text NOT NULL`, weight numeric NULL, timestamps | FK ranking/result RESTRICT; result-only first implementation; unique `(ranking_id,result_id)` and `input_hash`; indexes ranking/result | Exact immutable input set; one result may join many rankings. No arbitrary aggregate text identity. |
| `ranking_rows` | `id uuid PK`, `ranking_id uuid NOT NULL`, `competition_entry_id uuid NOT NULL`, rank int NOT NULL, points numeric NULL, tie_group text NULL | FK entry RESTRICT; unique `(ranking_id,competition_entry_id)` and `(ranking_id,rank,competition_entry_id)` as appropriate; rank/points checks; index ranking/rank | Published rows immutable; subtype determines participant/team subject; aggregate subjects deferred. |
| `awards` | `id uuid PK`, `competition_entry_id uuid NOT NULL`, ranking/result/qualification references NULL, award_type text NOT NULL, points numeric NULL, `regulation_version_id uuid NOT NULL`, status, timestamps | FK entry RESTRICT; unique award scope/entry/type; points nonnegative | First slice constrains awards to competition entries. Wilaya/organization/delegation aggregate recipients require a future explicit AwardSubject model; no polymorphic nullable FKs. |

## 4. Entry XOR enforcement

PostgreSQL cannot enforce a cross-table XOR with a simple `CHECK`. The recommended layered design is:

1. `individual_entries.competition_entry_id` and `team_entries.competition_entry_id` are each PK/FK to `competition_entries(id)`.
2. `competition_entries.entry_type` is `INDIVIDUAL` or `TEAM` with a check constraint.
3. A deferred constraint trigger, using a single transaction, requires exactly one subtype row and verifies that it matches `entry_type` before the entry becomes `VALIDATED` or later.
4. Restricted write permissions prevent direct subtype manipulation outside the domain service; the trigger remains authoritative against bypasses.
5. Partial unique indexes prevent duplicate active participant/team submissions within stage/category.

The subtype tables duplicate immutable `stage_id`, `category_id`, and a controlled `participation_state` solely to make ordinary partial unique indexes implementable without a cross-table JOIN. A deferred consistency trigger synchronizes the state from `competition_entries.status` and rejects mismatches; this trigger-enforced invariant is distinct from the ordinary unique indexes.

Concurrency behavior: validation runs in one transaction and locks a deterministic advisory key or the relevant stage/category/subject rows before state promotion. The partial unique index is the final conflict guard. Two simultaneous submissions for the same participant/team cannot both become `VALIDATED`; one transaction succeeds and the other receives a unique/deferred-constraint conflict and must retry or remain rejected.

This avoids a final design with two nullable foreign keys and supports safe multi-step creation inside one transaction.

## 5. Regulation immutability and effective-date overlap

Use four layers:

- application/service authorization requires a new version for every change;
- table privileges deny uncontrolled direct writes to regulation tables;
- a `BEFORE UPDATE OR DELETE` trigger checks the row status and rejects mutation when status is `APPROVED`, `ACTIVE`, or `RETIRED`, recording denied attempts where feasible;
- optional RLS/security-definer controls may be evaluated later, but are not assumed by this design.

The database trigger remains authoritative even if application authorization is bypassed. Published rows are never silently mutated or hard-deleted.

Represent effective scope as `daterange` and use a PostgreSQL `EXCLUDE` constraint over a deterministic, non-null normalized scope key plus the range to prevent overlapping `ACTIVE` versions at identical precedence. If scalar equality operators are needed in the exclusion constraint, the deployment must enable and approve `btree_gist`; otherwise activation must run a serializable transaction that locks the normalized scope and validates overlap before changing status. Nullable dimensions are normalized to explicit sentinel values or a canonical scope key before exclusion; ordinary NULL semantics are not relied upon.

### Operational person identity

The current NSSMS model has users and participants, but no generic `Person`. The physical design therefore proposes `people` as an optional new table, not yet implemented. `Participant` remains the athlete identity; `User` remains the login/account identity; `Person` represents an operational human such as coach, referee, or head of delegation. A person may optionally relate to a user account or participant, but neither relationship is required. Coaches/referees are not forced to log in and are not modelled as participants unless they are actually athletes.

## 6. Constraint and referential-action matrix

| Area | Required rule | Action |
|---|---|---|
| Governed parent references | Historical parent cannot disappear | `ON DELETE RESTRICT`, `ON UPDATE RESTRICT` |
| Optional provenance/archive metadata | Absence is allowed, history remains | `ON DELETE SET NULL` only where explicitly approved |
| Entry XOR | Exactly one subtype | PK/FK + entry_type check + deferred trigger |
| Cross-table active-entry uniqueness | Stage/category/subject spans parent and subtype | Duplicated immutable scope/state keys + deferred consistency trigger + subtype partial UNIQUE indexes; parent status is never used as an index predicate |
| Active regulation overlap | Same scope cannot overlap | range exclusion/activation validation |
| Region membership | No retroactive boundary rewrite | versioned rows + unique/exclusion checks |
| Published ranking | Immutable input set | permissions + trigger + append-only revision |
| Result corrections | Preserve official history | result revisions/validations, no destructive update |
| Hard delete | Not allowed for governed records | archive/status only |

### NULL-sensitive uniqueness

PostgreSQL ordinary `UNIQUE` permits multiple `NULL` values. For nullable programme/category/event/stage dimensions, the design uses one of these explicit strategies per table: `UNIQUE NULLS NOT DISTINCT` on supported PostgreSQL versions; a canonical non-null normalized scope key; or separate partial unique indexes for each nullability case. No uniqueness claim depends on `NULL = NULL`.

## 7. Index and query strategy

High-volume tables are expected to be `results`, `ranking_inputs`, `ranking_rows`, `audit_logs`, `competition_entries`, and possibly `team_members`. Recommended indexes include:

- `competition_stages (competition_id,parent_stage_id,status)` and geography/scope fields;
- `competition_entries (stage_id,category_id,status)` plus partial active-entry indexes;
- `results (stage_id,event_id,category_id,status,created_at)` and unresolved-context partial index;
- `ranking_inputs (ranking_id,result_id)` and `ranking_rows (ranking_id,rank)`;
- `regulation_versions` scope/status plus GiST effective-period index;
- `region_memberships` programme/wilaya/effective-period using `wilaya_id smallint`;
- `competition_stages` geography using `wilaya_id smallint`, `daira_id integer`, and `commune_id integer`;
- `audit_logs` actor/time/object indexes.

Use keyset pagination for results, entries, audit logs, and ranking rows. Avoid offset pagination on large historical tables. Query plans must include authorization-scope predicates before direct-ID lookup. Published rankings may use immutable/materialized projections, but input identity remains queryable.

## 8. JSONB policy

JSONB is acceptable only for genuinely sport-specific raw measurements, imported evidence snapshots, and algorithm diagnostics whose structure varies by discipline and is preserved alongside relational identity. Relational columns are mandatory for identity, lifecycle, scope, ownership, regulation/version, provenance, qualification, ranking membership, award decisions, and audit. `results.result_data` remains for backward compatibility; new structured fields should be relational and the JSON payload retained losslessly.

## 9. Soft delete, archive, and audit

Regulations, sources, stages, entries, results, qualifications, rankings, awards, and revisions have no normal hard-delete path. Use status plus `archived_at`, preserve foreign keys, and retain source/provenance. Audit create, submit, validate, approve, activate, publish, retire, supersede, withdraw, disqualify, substitute, assign official, change venue, correct result, recalculate ranking, grant award, and export/report operations. Audit entries include actor, scope, object, before/after hash or snapshot reference, reason, timestamp, and request correlation id.

## 10. Authorization and commune/region compatibility

ARCH-001 supports national, association/wilaya, daira, and institution scopes. The physical design therefore stores explicit organization/wilaya/daira/institution references where known, but does not add `COMMUNE` or `REGION` roles or scope enums. Stages and entries may retain `commune_id`/`programme_region_id` as data attributes for filtering and provenance, while authorization resolution remains an approved policy decision. Every protected query must join the authorized scope path; direct IDs must not bypass it.

## 11. Migration plan

### Phase 0 — readiness and backups

- Introduce no production tables yet; capture schema inventory, row counts, checksums, backup/restore evidence, and rollback point.
- Validate deployment compatibility and permissions.
- Rollback: no data change; discard design artifacts only.

### Phase 1 — regulation/configuration foundation

- Tables: regulation versions/rules/sources, programmes, programme regions, memberships, sports/events/categories, bindings.
- Transitional fields: all references from existing competitions/results nullable.
- Backfill: official source metadata only where deterministic.
- Validation: overlap, immutability, provenance, and scope tests.
- Rollback: disable new readers; drop only newly empty structures after review.

### Phase 2 — programme/stage/event foundation

- Tables: competition stages, calendar occurrences, venues, stage/occurrence venues.
- Backfill: create imported/default stages only where competition dates and evidence justify it.
- Validation: parent hierarchy, date windows, venue multiplicity, region membership.
- Compatibility: existing competition lifecycle remains authoritative for legacy rows.

### Phase 3 — entry/team foundation

- Tables: competition entries, individual/team subtype tables, teams/members, delegations/members, officials/assignments.
- Transitional: entry context nullable until new workflow proves complete; subtype XOR enforced for new validated entries first.
- Validation: duplicate submissions, membership roles, authorization scope.

### Phase 4 — results compatibility layer

- Add nullable stage/occurrence/entry/event/category/regulation/provenance references to existing results; preserve `result_data`.
- Backfill only deterministic mappings; mark all other rows unresolved.
- Validation: old result reads, new result writes, no fabricated context, revision/audit capture.

### Phase 5 — qualification/ranking/awards

- Tables: qualifications, rankings, ranking inputs/rows, awards, result revisions/validations.
- Require immutable input sets and active rule versions for new published outputs.
- Rollback: retain old result path and hide new projections; never delete published history.

### Phase 6 — known historical context

- Backfill source season/report, event/category, stage, and regulation references only where evidence is deterministic.
- Produce reconciliation reports and unresolved counts.
- Rollback: remove only additive backfill references, preserving originals and snapshots.

### Phase 7 — stricter constraints

- After evidence and workflow validation, make selected new references non-null for new official records.
- Enable deferred XOR, active-version overlap, and published immutability enforcement.
- Deploy trigger/permission changes with a tested rollback window.

### Phase 8 — retire legacy paths

- Only after acceptance tests, backups, reconciliation, and operational approval.
- Stop new legacy result writes; retain read-only compatibility until historical verification completes.
- No physical deletion of governed records.

## 12. Deployment, backup, and rollback strategy

Deploy additive tables/indexes before application readers; deploy dual-read/dual-write only after permissions and audit are ready; enforce constraints last. Take a verified backup and restore rehearsal at each destructive-risk boundary. Use feature flags or route-level cutover for new readers. Rollback means disabling new paths and retaining additive data, not restoring over production without an approved recovery procedure.

## 13. Pagination, retention, and authorization-query implications

Results, audit, entries, and ranking rows require keyset pagination and stable `(created_at,id)` cursors. Retention must preserve regulation provenance, published rankings, awards, revisions, and audit records for the required historical period; legal retention duration remains open. Authorization predicates must be applied in the base query and resource lookup, including stage → host/organization/geography and entry → institution paths. Commune/region data is not an authorization grant until a later decision.

## 14. Migration risks

- Ambiguous legacy result context and incomplete provenance.
- Existing consumers expecting direct Competition→Result or optional Participant semantics.
- Large result/ranking backfills and index build time.
- Incorrect region boundary assumptions.
- Trigger/permission gaps allowing published-rule mutation.
- Authorization ambiguity for commune/region stages.
- Sport-specific payloads that exceed relational assumptions.

## 15. Open questions

1. Final approval authority and database ownership for each regulation scope.
2. Exact PostgreSQL implementation of normalized scope keys for range exclusion.
3. Whether rankings are materialized, derived, or hybrid at national scale.
4. Mandatory versus optional venue inspections, official accreditation, appeals, and substitutions.
5. Retention duration and approved archive location for source PDFs and audit snapshots.
6. Procedure for resolving legacy results with unknown regulation/event context.
7. Final authorization decision for COMMUNE and REGION scopes.

## 16. Non-executable DDL illustration

The following is intentionally illustrative and incomplete; it is not a migration or runnable SQL:

```sql
-- Conceptual only:
competition_programmes(id uuid primary key, season_id uuid not null, ...)
regulation_versions(id uuid primary key, programme_id uuid null, effective_period daterange not null, ...)
competition_stages(host_wilaya_id smallint, host_daira_id integer, host_commune_id integer, ...)
competition_entries(id uuid primary key, entry_type text not null, ...)
individual_entries(competition_entry_id uuid primary key references competition_entries, participant_id uuid not null, stage_id uuid not null, category_id uuid not null, ...)
team_entries(competition_entry_id uuid primary key references competition_entries, team_id uuid not null, stage_id uuid not null, category_id uuid not null, ...)
-- A deferred constraint trigger enforces entry_type XOR and duplicated-key consistency.
-- An approved btree_gist-backed EXCLUDE (or serializable activation check) protects effective ranges.
-- ranking_inputs contains result_id uuid not null and preserves the immutable input set.
ranking_rows(ranking_id uuid not null, competition_entry_id uuid not null, ...)
awards(competition_entry_id uuid not null, award_type text not null, ...)
qualifications(source_entry_id uuid not null, destination_stage_id uuid not null, ...)
-- Existing physical audit table is audit_logs.
```

## 17. Decision boundary

This document defines a physical design and migration plan only. It does not execute SQL, create migration files, modify the current schema, add roles, implement commune/region authorization, or authorize ARCH-006.
