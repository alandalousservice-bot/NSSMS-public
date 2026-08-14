# ADR: Versioned Competition Regulations Architecture

**Status:** Proposed architecture decision — approval required  
**Task:** `NSSMS-ARCH-003`  
**Scope:** Documentation and architecture analysis only. No application, schema, migration, or workflow change is authorized by this ADR.

## 1. Context

NSSMS competitions are governed by rules that vary by season, programme, sport, event, category, and stage. ARCH-002 established from the official circular, national guide, and technical report that the programme includes staged progression, individual and collective sports, gender and age cohorts, sport-specific participation constraints, qualification, rankings, awards, and calendar windows.

The current NSSMS foundation contains seasons, competitions, participants, results, licenses, institutions, organizations, and audit records. The logical model does not yet provide an approved representation for competition stages, technical rules, qualification formulas, or historical rule provenance. The current `results.result_data` is flexible, but flexibility alone does not make a result reproducible under the exact regulation that produced it.

## 2. Problem

Hard-coding dates, birth-year cohorts, regional grouping, quotas, team sizes, substitutions, weights, distances, event formats, match durations, qualification formulas, ranking formulas, or medal rules would make later seasons unsafe to operate and would make historical results difficult to interpret. A published rule must also remain auditable and must not be silently changed after results depend on it.

## 3. Decision

Adopt a versioned competition-regulations architecture in which regulations are treated as governed configuration, not global code constants.

Each approved regulation version is associated with a scope such as season, programme, sport, event, category, and/or stage; carries effective dates; records official source provenance; and is immutable once published/active. A new season may reuse, copy, or derive from a previous version, but any change creates a new version. Sport-specific rules override broader programme rules only when explicitly defined by the applicable regulation.

Missing rules fail safely. The system must not infer undocumented defaults, silently carry an obsolete rule forward, or mutate a published version in place.

## 4. Alternatives considered

1. Keep all rules as global constants in application code.
2. Store one mutable rule set per season without immutable revisions.
3. Store opaque JSON per competition with no governed version identity.
4. Create a separate bespoke schema for every sport.
5. Adopt scoped, immutable regulation versions with explicit inheritance and overrides (the selected decision).

## 5. Rejected alternatives

- **Global code constants:** cannot represent season or discipline variation safely and require deployments for policy changes.
- **Mutable season rule set:** destroys historical reproducibility and audit certainty.
- **Unversioned competition JSON:** permits undocumented drift, weak provenance, and inconsistent interpretation across endpoints.
- **One schema per sport:** duplicates lifecycle/audit concerns and makes cross-sport reporting and governance unnecessarily fragmented.

## 6. Consequences

Positive consequences:

- Historical results can point to the exact regulation version used for eligibility, scoring, ranking, and awards.
- New seasons can reuse or derive prior rules without mutating prior history.
- Sport-specific exceptions are explicit rather than hidden in handlers.
- Publication, approval, audit, and source provenance become inspectable governance data.

Costs and risks:

- Rule resolution is more complex than reading a single global constant.
- Validation must detect conflicting or incomplete overrides before activation.
- Administration requires lifecycle permissions and careful effective-date handling.
- Reporting must show both result data and the governing rule version.

## 7. Data ownership

- **National governance authority:** owns national programme policy, approval of national rule versions, and conflict decisions within its mandate.
- **Programme owner:** owns programme-level calendar, stage, and participation configuration.
- **Discipline technical authority:** owns sport/event/category technical rules, subject to programme and national approval.
- **Competition/stage operator:** owns operational entries, assignments, results, and evidence within the active regulation scope; it does not rewrite regulation content.
- **Audit authority:** owns audit retention and review access, not business-rule authorship.

These are architectural ownership concepts, not new application roles.

## 8. Versioning model

The conceptual model uses a **regulation version** with:

- stable identity and human-readable title;
- version number and parent/derived-from reference where applicable;
- scope dimensions: season, programme, sport, event, category, stage;
- lifecycle state;
- effective start and end (or superseded) dates;
- structured rule values and validation metadata;
- source-document provenance;
- created, approved, published, retired, and superseded timestamps.

An implementation may represent these concepts with one or more entities/tables; this ADR does not select concrete SQL tables.

## 9. Effective dates

Rule applicability is resolved using both scope and effective dates. A regulation version must not apply outside its effective interval unless an explicit transitional rule authorizes it. Overlapping active versions with the same scope must be rejected or resolved by an approved precedence rule before publication.

Competition dates, registration cut-offs, eligibility cut-offs, and result dates must be evaluated against the applicable version, not the current wall-clock configuration.

## 10. Historical reproducibility

Every finalized result, qualification decision, ranking, award, and eligibility decision must be interpretable under the regulation version used at the time. Historical records must retain the resolved regulation identity (or an immutable resolution snapshot) and the source provenance needed to reproduce the decision.

Corrections create audited revisions to the result/decision; they do not rewrite the historical regulation version.

## 11. Rule inheritance / overrides

Resolution proceeds from broad to narrow scope, for example:

```text
National baseline → Season → Programme → Sport → Event → Category → Stage
```

A narrower rule overrides a broader rule only when the regulation explicitly declares the override and the resulting configuration passes validation. Absence of a narrower rule means “not specified,” not an inferred default. Conflicting same-level rules are invalid until resolved by the designated authority.

## 12. Season vs programme vs discipline rules

- **Season rules:** birth-year cohorts, season calendar boundaries, general eligibility, and season-wide governance.
- **Programme rules:** stage sequence, regional grouping, programme calendar, broad participation and progression constraints.
- **Discipline rules:** event formats, team sizes, reserves/substitutions, weights, distances, match durations, technical measurements, qualification and ranking formulas, and discipline-specific awards.
- **Stage rules:** local dates, venue/host details, quotas, and operational constraints where officially prescribed.

The architecture must permit a discipline or stage rule to override a programme rule without changing the programme or season baseline.

## 13. Immutable published rule versions

Lifecycle states are:

```text
DRAFT → APPROVED → ACTIVE → RETIRED
```

- **DRAFT:** editable, not usable for official decisions.
- **APPROVED:** authorized content awaiting its effective date/publication.
- **ACTIVE:** authoritative for its scope and effective interval; immutable.
- **RETIRED:** no longer applicable to new decisions but retained for historical interpretation.

Published/active versions must never be silently mutated or deleted. A correction is a new version with a new identity and an audit trail.

## 14. Audit requirements

Audit events must capture creation, revision, approval, activation, retirement, derivation, override, conflict resolution, and publication. Each event should identify actor, timestamp, prior and resulting version, reason, source references, and affected scope. Access to audit data is protected by the existing authorization model and must preserve historical availability.

## 15. Source-document provenance

Every approved regulation version must retain provenance to its official source document(s), including document title, issuer, issue date, document identifier, page/section when known, and a content hash or archived reference where operationally available.

For ARCH-002 evidence, provenance includes the 2025/2026 ministerial circular 1033, the 2025/2026 National School Sports Competition Guide, and the 2021/2022 `BILAN-TECHNIQUE-AGO` report. The BILAN is operational evidence and must not be promoted to a normative rule without a prescriptive source.

## 16. Conflict resolution

Conflict precedence is:

1. A later approved normative instrument with authority over the same scope.
2. A more specific approved rule, when the broader rule explicitly allows overrides.
3. An approved transitional decision recorded by the responsible authority.

Unresolved conflicts block activation. Operational observations cannot override normative requirements merely because they occurred historically. The conflict, decision, authority, and effective date must be audited.

## 17. Validation strategy

Before approval/activation, validation should check:

- required scope and effective dates are present;
- no overlapping active versions exist at the same precedence/scope;
- inheritance resolves to one unambiguous value per required rule;
- mandatory sport/category/stage rules are complete;
- quotas, team sizes, weights, distances, and dates are internally consistent;
- qualification and ranking formulas reference only approved inputs;
- provenance is complete;
- published versions are immutable.

At runtime, missing or conflicting rules fail closed with an explicit governance error; they must not fall back to undocumented defaults.

## 18. API implications — analysis only

Future API contracts should expose regulation identity, lifecycle, scope, effective interval, provenance, and resolution outcome where relevant. Competition registration, eligibility, qualification, ranking, and award endpoints should evaluate against an explicit regulation context and return a traceable version reference. Draft and retired versions must not be used for official decisions. No API change is implemented by this ADR.

## 19. Database implications — analysis only

The database will eventually need conceptual support for immutable regulation versions, scoped rule values, inheritance/override links, effective intervals, provenance, and references from historical decisions/results. Concrete table names, columns, indexes, constraints, and migrations are intentionally deferred. Existing seasons, competitions, results, audit records, and archive fields remain backward-compatible inputs to that later design.

## 20. Security/authorization implications

Regulation authoring, approval, activation, retirement, override, and conflict resolution require distinct permission checks and administrative scope enforcement. A user may only manage rules within their authorized national, association/wilaya, daira, or institution scope, subject to the eventual authority matrix. Backend authorization is authoritative; frontend visibility is not. Historical rule and provenance access must respect audit/reporting permissions.

## 21. Migration strategy — analysis only

No migration is created here. A future migration plan should:

1. inventory existing season/competition/result records;
2. assign an explicit legacy or imported regulation reference where evidence exists;
3. mark unknown historical rule context as unresolved rather than inventing values;
4. preserve existing result payloads and audit history;
5. introduce new regulation references additively;
6. validate old and new workflows before tightening requirements.

## 22. Backward compatibility

Existing competitions and results remain readable. Legacy records without a known regulation version must be labelled as having incomplete provenance and must not be silently treated as compliant with a current regulation. New official decisions require a valid active regulation context. Existing lifecycle and authorization behavior remains unchanged until a separately approved implementation task.

## 23. Open questions

1. Which authority may approve national, programme, discipline, and stage-level regulation versions?
2. What is the canonical machine-readable vocabulary for scopes, sports, events, categories, rankings, awards, and lifecycle states?
3. Which rules are mandatory for every sport versus optional discipline overrides?
4. How should emergency amendments and transitional dates be represented?
5. What provenance retention/archive service is authoritative for source PDFs?
6. What disclosure is permitted for draft, active, retired, and historical regulations?
7. How are unresolved legacy results reviewed and assigned a regulation reference?

## 24. Decision boundary

This ADR selects a versioned-regulation architecture for review. It does not authorize application code, database schema changes, migrations, API changes, new roles, or implementation of competition features.
