# NSSMS Competition Domain — Logical Data Model

**Status:** Logical analysis only — approval required  
**Task:** `NSSMS-ARCH-004`  
**Scope:** No SQL, migrations, application code, API implementation, or schema change.

## 1. Purpose and evidence boundary

This model extends the current NSSMS logical model (seasons, competitions, organizations, institutions, participants, licenses, results, and audit events) using the approved ARCH-002 competition analysis and ARCH-003 versioned-regulations ADR. The official references confirm a 2025/2026 staged programme, sport/event/category variation, individual and team participation, qualification, results, rankings, awards, and calendar windows; the 2021/2022 BILAN supplies operational historical evidence.

Rules remain versioned configuration. Season-specific or sport-specific values are not global constants. Proposed entities below are conceptual and are not implementation instructions.

## 2. Modeling decisions

1. **Competition is a governed container.** It belongs to a season and programme and may contain one or more stage occurrences. A `CompetitionStage` represents the dated geographic/operational occurrence; Competition is not duplicated for every level.
2. **Stages reference reusable event definitions.** `Event` and `Category` are reusable definitions scoped by regulation/programme; a stage schedules applicable events through occurrence/configuration links.
3. **Stage hierarchy is data-driven.** A stage has a regulation-defined level code and optional parent stage; no global enum is authoritative.
4. **Region membership is versioned.** Region-to-wilaya membership belongs to the applicable programme/regulation version.
5. **Entries use explicit subtypes.** Individual and team entries are separate conceptual records/relationships, avoiding a single nullable polymorphic row.
6. **Qualification is a decision record.** It links source entry/result/ranking to a destination stage and, when created, a destination entry.
7. **Results retain governing versions.** Every official result stores or immutably references the regulation, event/category, and provenance context used to produce it.
8. **Rankings may be materialized projections.** Raw results are authoritative; a published ranking is stored as a versioned/validated projection with its calculation context.
9. **Awards are separate decisions.** Medals, points, trophies, and certificates are not inferred solely from a mutable rank.
10. **Corrections append history.** Result revisions and validation history preserve prior official states.

## 3. Entity classification

| Entity/concept | Classification |
|---|---|
| Season, Competition, Organization, EducationalInstitution, Participant, SportsLicense, Result, AuditEvent | SYSTEM-DOMAIN EXISTING |
| CompetitionProgramme, CompetitionStage, Sport, Event, Category, CalendarOccurrence, CompetitionEntry, Team, TeamMember, Delegation, DelegationMember, CompetitionOfficial, OfficialAssignment, Venue | NEW CORE ENTITY (conceptual) |
| RegulationVersion, RegulationRule/RuleSet, RegulationSource, RegionMembership, EventRuleBinding | NEW CONFIGURATION ENTITY |
| Qualification, Ranking, Award, ResultRevision, ResultValidation | NEW HISTORICAL/DECISION ENTITY |
| VenueInspection, Appeal, Substitution, EntryDocument, TechnicalRecord | OPTIONAL/FUTURE ENTITY |

## 4. Proposed entity definitions

The following definitions apply to every proposed entity. “Ownership” means the accountable domain authority, not a new application role. Administrative scope follows the ARCH-001 hierarchy: national, association/wilaya, daira, or institution.

### 4.1 Configuration and regulation entities

| Entity | Purpose and identity | Ownership/lifecycle | Key attributes and relationships | Cardinality, uniqueness, nullability | Historical/versioning, scope, audit |
|---|---|---|---|---|---|
| CompetitionProgramme | Approved programme for a season; identity is a stable programme id plus version context. | Programme/national authority; draft → approved → active → retired. | season, title, programme code, governing RegulationVersion. | One season may have many programmes; code unique within authority/season; dates and regulation FK non-null once approved. | Immutable after publication; source/provenance and full audit. National or programme scope. |
| RegulationVersion | Immutable applicable rule bundle. | Regulation owner; draft → approved → active → retired. | version number, parent/derived version, scope dimensions, effective interval, status. | No overlapping active versions at identical scope; parent optional; effective dates required for approved versions. | Exact version referenced by decisions/results; activation/retirement audited. Scope is explicit. |
| RegulationRule / RuleSet | A named rule value or formula within a regulation version. | Regulation owner; only editable in draft. | rule key, typed value/formula, unit, precedence, override target, validation metadata. | Rule key unique within version/scope; value nullable only when rule explicitly means “not specified.” | Never mutate active values; override chain and audit retained. |
| RegulationSource | Official document provenance. | Regulation owner; retained permanently. | title, issuer, identifier, issue date, page/section, hash/archive reference, evidence class. | A version has one or more sources; source identifier/hash unique where available. | Immutable provenance; access audited. |
| RegionMembership | Programme-versioned mapping of region to wilaya. | National/programme authority. | region code, wilaya id, programme/regulation version, effective interval. | A wilaya belongs to at most one region within a programme version unless an explicit transition exists. | Historical membership retained; scope national/programme. |
| EventRuleBinding | Applies a regulation rule set to an event/category/stage. | Discipline/programme authority. | event, category, stage scope, regulation version, override precedence. | One effective binding per rule key and scope. | Resolution trace retained for official outcomes. |

### 4.2 Competition operation entities

| Entity | Purpose and identity | Ownership/lifecycle | Key attributes and relationships | Cardinality, uniqueness, nullability | Historical/versioning, scope, audit |
|---|---|---|---|---|---|
| CompetitionStage | Dated institution/commune/daira/wilaya/region/national occurrence; identity is stage id. | Stage operator; draft → scheduled → active → results → closed/archived. | competition, level code, parent stage, programme/regulation version, host, venue, dates. | Competition has one or more stages; parent optional only for root; level and regulation non-null. | Published stage metadata immutable after start except audited correction. Scope follows stage geography. |
| Sport | Reusable discipline reference. | Discipline authority; active/retired. | code, name, sport type. | Code globally unique within approved vocabulary. | Version changes use new code/version or effective reference; not silent rename. |
| Event | Reusable contest definition. | Discipline authority; draft → approved → retired. | sport, code, format, measurement type, rule binding. | Event code unique within sport/version; sport non-null. | Technical definition versioned through regulation binding. |
| Category | Age/gender/education/technical cohort. | Programme/discipline authority. | code, gender dimension, age/birth-year rule reference, technical class. | Code unique within programme/rule version; dimensions explicit, not inferred. | Rule version and effective interval required. |
| CalendarOccurrence | Published date/window for a stage/event. | Programme/stage authority; draft → approved → published → completed. | stage, event/category, start/end, registration deadlines, source. | No conflicting occurrences for same stage/event/category; dates non-null when published. | Source and regulation version retained. |
| CompetitionEntry | Participation submission. | Institution/team/stage authority; draft → submitted → validated → withdrawn/disqualified. | stage, entry type, institution, participant or team reference, category, eligibility evidence. | Exactly one explicit entry subtype; no duplicate active entry for same subject/stage/category. | Entry retains decision and regulation context; scope institution through stage. |
| Team | Named collective unit. | Institution/association; draft → submitted → active → completed. | institution/representing unit, name, category, stage/competition context. | Name unique within stage/category/representing institution; ownership non-null. | Membership changes audited; team identity not reused across incompatible categories. |
| TeamMember | Explicit team-athlete membership. | Team owner; proposed → confirmed → ended. | team, participant, role (athlete/reserve), join/leave, entry. | Participant cannot be active twice in same team/category; role controlled by regulation. | Membership history retained; substitution is append-only decision data. |
| Delegation | Group travelling/representing an institution or qualified unit. | Delegating authority; draft → approved → active → closed. | stage, representing unit, head, scope, accreditation reference. | One delegation may cover a stage; composition rules come from regulation. | Members and role changes audited; event-specific composition is versioned. |
| DelegationMember | Person-role membership in delegation. | Delegation owner. | delegation, person, role (athlete/coach/head/official/support), dates. | Role and person unique within delegation interval. | Retain historical composition and approvals. |
| CompetitionOfficial | Person qualified/appointed for event operations. | Technical authority; proposed → approved → retired. | person, official type, accreditation/provenance. | Accreditation uniqueness depends on authority and validity interval. | Appointment and accreditation evidence retained. |
| OfficialAssignment | Assignment of official to stage/event. | Competition technical authority; draft → assigned → completed. | official, stage/event, function, dates. | No conflicting assignment for same function/time unless regulation permits. | Assignment and sign-off audited. |
| Venue | Location used by an occurrence. | Host authority; proposed → approved → retired. | geography, facility, capacity/technical attributes. | Facility identifier unique within authority. | Inspection/source history retained where available. |

### 4.3 Results, decisions, and history entities

| Entity | Purpose and identity | Ownership/lifecycle | Key attributes and relationships | Cardinality, uniqueness, nullability | Historical/versioning, scope, audit |
|---|---|---|---|---|---|
| Qualification | Explicit progression decision. | Stage/technical authority; draft → approved → applied → superseded. | source entry/result/ranking, destination stage/entry, decision reason, quota/rule version. | At least one source and destination stage; destination entry may be pending; no duplicate active decision. | Immutable decision with regulation/provenance; corrections supersede. |
| Result | Raw or official performance for entry/event. Existing concept retained. | Event official; draft → submitted → validated → published → superseded. | entry, event/category, value/unit/placing, status, regulation/event-rule references. | One official result per entry/event/attempt as permitted by rule; sport-specific payload may be JSON only for extensible measurements. | Exact rule version, source, and validation history required for official status. |
| Ranking | Ordered projection for event/stage/category. | Technical authority; calculated → reviewed → published → superseded. | scope, ordering, inputs, formula/rule version, rank rows. | One published ranking per scope/version; tie representation explicit. | Recomputable from retained inputs; publication immutable. |
| Award | Medal/points/trophy/certificate decision. | Awarding authority; proposed → approved → published → superseded. | recipient/result/ranking, award type, points, rule version. | Unique award per recipient/scope/type unless regulation allows multiples. | Source and decision audit retained. |
| ResultRevision / ResultValidation | Append-only correction and validation history. | Authorized official/authority; recorded → approved/rejected. | result, prior snapshot/hash, new snapshot, reason, actor, timestamp, decision. | Every revision references exactly one prior state; no destructive overwrite. | Required for official corrections; audit and provenance immutable. |

## 5. Relationship matrix

| From | Relationship | To | Cardinality / rule |
|---|---|---|---|
| Season | contains | CompetitionProgramme | 1:N |
| Season | contains | Competition | 1:N; existing relationship retained |
| CompetitionProgramme | governs | Competition | 1:N |
| Competition | contains | CompetitionStage | 1:N |
| CompetitionStage | has parent | CompetitionStage | 0:1 parent; N children |
| Programme/RegulationVersion | defines | Stage/Sport/Event/Category rules | 1:N |
| CompetitionStage | schedules | CalendarOccurrence | 1:N |
| CompetitionStage | offers | Event/Category | N:M through occurrence/binding |
| CompetitionStage | receives | CompetitionEntry | 1:N |
| CompetitionEntry | represents | Participant or Team | exactly one explicit subtype |
| Team | has | TeamMember | 1:N |
| Delegation | has | DelegationMember | 1:N |
| CompetitionOfficial | receives | OfficialAssignment | 1:N |
| CompetitionStage | occurs at | Venue | 0:1 or 1:1 when required by rule |
| CompetitionEntry/Event | produces | Result | 1:N attempts; 1 official result where applicable |
| Result/Ranking | supports | Qualification | 0:N |
| Qualification | targets | CompetitionStage/Entry | 1 destination stage; entry may be created later |
| Result | contributes to | Ranking | N:1 per ranking calculation |
| Result/Ranking | grants | Award | 0:N |
| Result | has | ResultRevision/Validation | 1:N append-only |

## 6. Invariants and data-integrity rules

1. Every competition belongs to a valid season and approved programme context.
2. Every official stage, entry, result, qualification, ranking, and award references an active or historical regulation version appropriate to its effective date.
3. A stage level, region membership, quota, category, team size, weight, distance, and formula are resolved from versioned rules; no undocumented default is permitted.
4. An entry has exactly one participation form: individual or team; team membership is explicit.
5. A qualification cannot target a stage incompatible with the source stage, category, sport, or approved progression rules.
6. Published results, rankings, awards, and regulation versions are immutable; corrections append revisions.
7. A ranking is reproducible from its retained result inputs and rule version.
8. A result cannot be officially validated without an assigned event official or approved validation authority where the regulation requires one.
9. Region membership is unique within a programme version and never retroactively changes historical stages.
10. Governed records are not physically deleted through normal business operations.

## 7. Versioning and provenance rules

- Regulations are versioned configuration, not hard-coded global business rules.
- Published regulation versions are immutable.
- New seasons may reuse, copy, or derive prior rules, but every change creates a new version.
- Sport-specific rules override broader programme rules only through explicit approved bindings.
- Historical decisions retain the exact regulation, event/category, and source provenance used.
- Official source metadata includes title, issuer, identifier, issue date, page/section, and hash/archive reference where available.
- Legacy records without known provenance remain readable but are marked unresolved; current rules are not inferred retroactively.

## 8. Scope and authorization implications

Authorization applies to both the actor permission and the domain scope. National users may manage national/programme rules; wilaya/association users are restricted to assigned wilaya/organization; daira users to their daira and subordinate data; institution users to their institution and subordinate entries/participants. Direct IDs for stages, entries, teams, delegations, results, rankings, awards, or regulation versions must be checked against the resolved administrative scope. Cross-scope reads and writes return the established 401/403 behavior from ARCH-001.

## 9. Current-model gaps

The existing logical model does not explicitly represent programmes, stages, sport/event/category definitions, calendar occurrences, entries, teams/memberships, delegations, officials/assignments, venues, qualifications, rankings, awards, regulation versions/rules/sources, region membership versions, or append-only result revisions. Existing `results.result_data` does not guarantee structured ranking, qualification, or provenance semantics.

## 10. Migration implications — analysis only

No SQL or migration is proposed. A future migration should inventory current competitions/results, preserve all existing JSON payloads, assign a known regulation reference when evidence exists, mark unknown provenance explicitly, introduce references additively, and validate old workflows before enforcing new non-null governance links.

## 11. Performance and indexing considerations — analysis only

Future physical design should index regulation scope/effective dates, stage parent and geography, entry subject/category, result event/entry/status, qualification source/destination, ranking publication scope, and audit timestamps. Resolution queries should avoid unbounded inheritance walks; published versions may use cached/materialized resolution snapshots while retaining source rule identity. These are analysis considerations, not schema instructions.

## 12. High-level domain relationship diagram

```mermaid
erDiagram
  SEASON ||--o{ COMPETITION_PROGRAMME : governs
  SEASON ||--o{ COMPETITION : contains
  COMPETITION_PROGRAMME ||--o{ COMPETITION : configures
  COMPETITION ||--|{ COMPETITION_STAGE : contains
  COMPETITION_STAGE ||--o{ CALENDAR_OCCURRENCE : schedules
  COMPETITION_STAGE ||--o{ COMPETITION_ENTRY : receives
  COMPETITION_ENTRY ||--o{ RESULT : produces
  RESULT ||--o{ QUALIFICATION : supports
  RESULT ||--o{ AWARD : earns
  RESULT ||--o{ RESULT_REVISION : revises
  COMPETITION_ENTRY }o--|| PARTICIPANT : individual
  COMPETITION_ENTRY }o--|| TEAM : team
  TEAM ||--o{ TEAM_MEMBER : has
  DELEGATION ||--o{ DELEGATION_MEMBER : has
  COMPETITION_OFFICIAL ||--o{ OFFICIAL_ASSIGNMENT : receives
  COMPETITION_STAGE }o--|| VENUE : occurs_at
```

## 13. Regulation/configuration submodel

```mermaid
erDiagram
  COMPETITION_PROGRAMME ||--o{ REGULATION_VERSION : uses
  REGULATION_VERSION ||--o{ REGULATION_RULE : contains
  REGULATION_VERSION ||--o{ REGULATION_SOURCE : evidenced_by
  REGULATION_VERSION ||--o{ REGION_MEMBERSHIP : defines
  REGULATION_VERSION ||--o{ EVENT_RULE_BINDING : binds
  SPORT ||--o{ EVENT : contains
  EVENT ||--o{ CATEGORY : offers
  EVENT_RULE_BINDING }o--|| EVENT : targets
  EVENT_RULE_BINDING }o--|| CATEGORY : scopes
```

## 14. Competition operations submodel

```mermaid
erDiagram
  COMPETITION ||--|{ COMPETITION_STAGE : has
  COMPETITION_STAGE ||--o{ CALENDAR_OCCURRENCE : dates
  COMPETITION_STAGE ||--o{ COMPETITION_ENTRY : accepts
  COMPETITION_ENTRY }o--|| PARTICIPANT : individual_form
  COMPETITION_ENTRY }o--|| TEAM : team_form
  TEAM ||--o{ TEAM_MEMBER : membership
  DELEGATION ||--o{ DELEGATION_MEMBER : composition
  COMPETITION_STAGE ||--o{ OFFICIAL_ASSIGNMENT : operates
  COMPETITION_OFFICIAL ||--o{ OFFICIAL_ASSIGNMENT : assigned
  COMPETITION_STAGE }o--|| VENUE : hosted_at
```

## 15. Result/qualification/history submodel

```mermaid
erDiagram
  COMPETITION_ENTRY ||--o{ RESULT : records
  RESULT ||--o{ RESULT_REVISION : history
  RESULT ||--o{ RESULT_VALIDATION : validates
  RESULT }o--|| REGULATION_VERSION : governed_by
  RESULT }o--|| EVENT : measures
  RESULT }o--|| CATEGORY : classifies
  RESULT ||--o{ RANKING : contributes
  RANKING ||--o{ QUALIFICATION : decides
  QUALIFICATION }o--|| COMPETITION_STAGE : destination
  RESULT ||--o{ AWARD : yields
  AWARD }o--|| REGULATION_VERSION : governed_by
```

## 16. Open questions

1. Which concrete regulation scopes and approval authorities are permitted in the first implementation slice?
2. Should rankings be fully materialized, derived on demand, or hybrid by sport/scale?
3. What exact sport-specific payloads require JSON extensions after the relational minimum is defined?
4. How should unresolved legacy result provenance be reviewed and approved?
5. Which venue, official accreditation, appeal, and substitution concepts are mandatory rather than optional?
6. What canonical identifiers and vocabulary governance will be used for sports, events, categories, and stage levels?

## 17. Recommended implementation order

1. Approve vocabulary, authority matrix, and regulation-version lifecycle.
2. Implement regulation source/version/rule resolution and audit foundation.
3. Add programme, stage, sport/event/category, and calendar concepts.
4. Add explicit entries, teams, memberships, delegations, officials, and venues.
5. Add qualification, result validation/revision, ranking, and award decisions.
6. Migrate legacy result references conservatively and add cross-scope regression tests.

## 18. Decision boundary

This document is a logical model only. It does not select SQL tables, create migrations, change current entities, or authorize implementation. ARCH-005 is not started by this document.
