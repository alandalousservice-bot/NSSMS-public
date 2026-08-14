# NSSMS — Official School Sports Competition Domain Model

**Document status:** Analysis / documentation only  
**Task:** `NSSMS-ARCH-002`  
**Scope:** Competition-domain analysis; no application, database, API, workflow, or existing-document changes are implied by this document.

## 0. Evidence basis and certainty rules

This document was prepared from the reference material currently present in the repository:

- `docs/001_Business/003_Business_Processes.md`
- `docs/001_Business/007_Organizational_Model.md`
- `docs/001_Business/011_Business_Workflows.md`
- `docs/002_System/006_Functional_Requirements_Detail.md`
- `docs/004_Database/004_Logical_Data_Model.md`
- `docs/000_Project/007_Implementation_Readiness.md`
- `docs/000_Project/001_Project_Charter.md`

No separate ministerial competition calendar, official technical competition report, regulation book, or results bulletin was found in the repository at review time. The supplied geography archive contains wilaya/daira data only and is not a competition reference. Therefore, no legal or sport-specific rule is labelled **CONFIRMED** unless it is explicitly stated in an existing NSSMS reference. Any domain interpretation that would normally require an official calendar or technical report is labelled **PROPOSED** or **OPEN QUESTION**.

The labels have the following meaning:

- **CONFIRMED:** Explicitly stated in the available NSSMS reference documents. This is a repository-confirmed requirement, not a claim that a legal rule has been verified externally.
- **PROPOSED:** A useful modelling hypothesis that preserves the current project philosophy but requires business/regulatory approval.
- **OPEN QUESTION:** Not sufficiently evidenced to model as a rule.

## 1. Executive conclusion

The current NSSMS documentation establishes a controlled competition record that belongs to a season, has a governed lifecycle, accepts participation, records results, and remains historically accessible after closure. It also establishes institutions and participants as core concepts, and identifies national, regional/wilaya, institution, and competition-official responsibilities as logical actors.

The documentation does **not** establish an official school-sports competition ladder from commune to daira to wilaya to zone to national level. It does not establish sport calendars, age bands, gender divisions, team sizes, delegation composition, ranking formulas, points, medal rules, qualification quotas, venue rules, or referee accreditation. Those details must be obtained from the ministerial calendar and technical reports before being promoted to business rules.

## 2. Competition hierarchy and stages

### 2.1 Stage hierarchy

| Level or stage | Status | Analysis |
|---|---|---|
| Institution / school | **PROPOSED** | Natural entry level for school registration and participant/team submission. The repository confirms institution-participant relationships, but not an official institution-stage competition rule. |
| Commune | **OPEN QUESTION** | The data model contains communes as geographic reference data, but no competition reference defines commune qualifying events or commune authority. |
| Daira | **OPEN QUESTION** | Daira accounts and geography exist in the implementation, but no supplied reference confirms a daira competition stage or qualification rule. |
| Wilaya | **PROPOSED** | The organizational model identifies regional/wilaya administration and regional competition administration as potential responsibilities. An official wilaya-stage format is not confirmed. |
| Zone / region | **OPEN QUESTION** | No source defines the number, boundaries, naming, host authority, or qualification role of zones/regions. |
| National | **PROPOSED** | The project vision and charter establish national governance and national oversight. A national final or national qualifying stage is not explicitly defined. |

### 2.2 Competition lifecycle

The existing NSSMS analysis defines the following **PROPOSED** lifecycle:

```text
DRAFT → REVIEW → APPROVED → REGISTRATION → ACTIVE → RESULTS → CLOSED → ARCHIVED
```

The lifecycle is a system-governance state machine, not evidence of a physical competition hierarchy. The exact legal meaning of each state, approval authority, registration closing rule, and result publication rule remains subject to validation.

### 2.3 Qualification between stages

- **CONFIRMED:** The available references require controlled participation and results, and identify competition management as a business capability.
- **PROPOSED:** A competition instance may produce qualifiers who progress from an earlier geographic/institution stage to a later stage.
- **OPEN QUESTION:** Whether progression is based on winner status, ranking threshold, points, quota, invitation, age eligibility, or a ministerial selection decision.
- **OPEN QUESTION:** Whether qualification is individual, team-based, delegation-based, or a combination.
- **OPEN QUESTION:** Whether a participant may qualify in multiple sports or stages in the same calendar period.

## 3. Competition scope: sport, gender, age, and format

### 3.1 Individual and team sports

- **CONFIRMED:** The existing requirements refer to participants, participation, and results; institutions may participate in competitions.
- **PROPOSED:** Each competition event should declare a format: `INDIVIDUAL`, `TEAM`, or `MIXED`.
- **PROPOSED:** Individual events should produce participant entries and individual rankings; team events should produce team entries and team rankings while retaining athlete membership.
- **OPEN QUESTION:** Which sports are individual, team, relay, pair, combat, or mixed-format under the official programme.
- **OPEN QUESTION:** Whether a team may contain reserve athletes and whether reserves may compete.

### 3.2 Male and female categories

- **OPEN QUESTION:** The repository contains no official gender category list, eligibility definition, mixed-event rule, or terminology from a ministerial reference.
- **PROPOSED:** Gender/category must be an explicit property of an event or competition class, not inferred from a participant name or institution.
- **OPEN QUESTION:** Whether the official programme uses `MALE`, `FEMALE`, `MIXED`, or another approved vocabulary, and how registration exceptions are handled.

### 3.3 Age and category concepts

- **CONFIRMED:** Participant records include date of birth in the current physical model, and eligibility validation is identified as a required business capability.
- **PROPOSED:** An event should reference an approved age/category definition, with an effective date or cut-off date for eligibility calculation.
- **OPEN QUESTION:** Official age bands, school grades, birth-year cut-offs, exceptional eligibility, document evidence, and whether age is calculated on registration date, competition date, or season date.

## 4. Actors

| Actor | Status | Responsibility in the model |
|---|---|---|
| National administration | **CONFIRMED** as a logical stakeholder/responsibility | National configuration, season governance, competition oversight, policy, and reporting are identified in the organizational model. Exact legal authority remains open. |
| Wilaya/association administration | **PROPOSED** | Regional competition administration, local validation, monitoring, and reporting. The documents explicitly call these potential responsibilities. |
| Daira supervisor | **PROPOSED** | Local geographic coordination and review within a daira. The role exists in implementation, but competition-specific authority is not defined by the supplied business references. |
| Educational institution/school | **CONFIRMED** as a domain participant | Maintains participant information and may participate in competitions. |
| Athlete/participant | **CONFIRMED** as a domain participant | A participant belongs to an institution and may hold historical license records. Competition eligibility is still rule-dependent. |
| Coach | **OPEN QUESTION** | Requested by the task, but no supplied reference defines coach authority, accreditation, or relationship to teams/delegations. |
| Head of delegation | **OPEN QUESTION** | No supplied reference defines this role or its approval authority. |
| Competition official/referee | **CONFIRMED** only as a logical stakeholder category | The organizational model identifies competition officials and operational/result validation responsibilities. Referee licensing, appointment, and scoring authority are open. |
| Host/organizing wilaya | **PROPOSED** | A wilaya may host an event, subject to an approved hosting decision. The repository does not confirm host selection rules. |
| Venue operator | **OPEN QUESTION** | Venues are requested by the task, but no reference defines venue ownership, inspection, or booking responsibility. |
| Public verifier | **CONFIRMED** for license verification only | The public portal supports public license verification; public competition-result visibility is not fully specified. |

## 5. Entities

### 5.1 Confirmed or existing NSSMS entities

- **Season:** Groups competitions and related historical activities.
- **Competition:** Belongs to a season and contains participation/results.
- **Organization:** May govern institutions.
- **Educational institution:** Has participants and may participate in competitions.
- **Participant/athlete:** Belongs to an institution and may have historical licenses.
- **Result:** Records competition result data and may reference a participant.
- **Audit event:** Records actor, time, action, and affected object.

### 5.2 Competition-domain entities proposed for analysis

These are conceptual entities only; they are not implementation instructions:

- **Competition programme:** The approved sport/event catalogue for a season or calendar.
- **Competition stage:** One occurrence of an event at institution, commune, daira, wilaya, zone, or national level.
- **Sport:** The discipline, such as athletics or a ball sport, subject to official confirmation.
- **Event:** A contest within a sport, category, gender division, and format.
- **Entry:** An institution, team, or athlete submission to an event.
- **Team:** A named competition unit containing athletes and possibly reserves.
- **Delegation:** A group representing an institution or administrative unit at a stage.
- **Coach:** A person attached to a team/delegation if official rules confirm the role.
- **Head of delegation:** A responsible person attached to a delegation if official rules confirm the role.
- **Official/referee:** A person assigned to operate, judge, time, score, or validate an event.
- **Venue:** A place hosting an event, subject to official venue requirements.
- **Qualification:** A decision or record that allows an entry to progress to another stage.
- **Ranking:** Ordered standings for individuals or teams under an approved ranking method.
- **Award:** Medal, title, points, or other approved recognition.
- **Calendar occurrence:** A dated competition/stage window from an approved calendar.

## 6. Relationships

### 6.1 Confirmed relationships

```text
Season 1 ──< Competition
Organization 1 ──< EducationalInstitution
EducationalInstitution 1 ──< Participant
Participant 1 ──< SportsLicense
Competition 1 ──< Result
Result ──> Participant (optional in the current schema)
AuditEvent ──> Actor and affected business object
```

These relationships are explicitly represented in the logical data model and/or current schema.

### 6.2 Proposed competition relationships

```text
Competition ──< CompetitionStage
CompetitionStage ──< Event
Event ──< Entry
Entry ──> Institution, Team, or Participant
Team ──< TeamMember ──> Participant
Delegation ──< DelegationMember
CompetitionStage ──> HostWilaya and Venue
Entry ──< Qualification ──> NextStage
Event ──< Result ──< Ranking/Award
```

These relationships must not be treated as confirmed until the official programme and technical reports define the relevant objects and responsibilities.

## 7. Business rules

### CONFIRMED by current NSSMS references

1. A competition belongs to a season.
2. Competition status is controlled through a proposed governance lifecycle.
3. Authorized users manage competitions and participation.
4. Authorized officials may record results.
5. Closed competitions remain historically accessible.
6. Institutions are related to participants.
7. Participant eligibility must be validated according to approved rules.
8. Audit events must preserve actor and timestamp information and remain historically available.
9. The system must avoid normal physical deletion of governed records.

### PROPOSED for future validation

1. Every competition should have a sport, event, stage, calendar window, host, and status.
2. Every entry should be linked to an institution and, where applicable, a team or individual athlete.
3. Qualification should be a first-class historical decision rather than a derived label only.
4. Results should be immutable after official validation; corrections should be versioned and audited.
5. A team ranking should be calculated from an approved event scoring method, not hard-coded globally.
6. Individual and team awards should be separate records linked to the underlying result/ranking.
7. Delegation responsibility should be explicit when an institution sends participants to a stage.

### OPEN QUESTIONS

- Which authority approves the official competition programme and calendar?
- What rules distinguish an official competition from a training, friendly, or local event?
- What are the official qualification quotas, tie-breakers, and replacement rules?
- Which documents prove athlete eligibility, school membership, age, and gender category?
- Who can correct a result after publication, and how is the correction approved?
- Are rankings published publicly, and which fields are private?
- Can the same athlete appear in multiple teams or events in one stage?
- Are team names, uniforms, school identity, and delegation identity regulated?

## 8. Competition workflow

The current NSSMS workflow is **PROPOSED** and should be interpreted as a governance skeleton:

```text
Programme/calendar preparation
  → Competition draft
  → Review
  → Approval
  → Registration
  → Entry validation
  → Stage operation
  → Result entry
  → Result validation/publication
  → Closure
  → Historical archive
```

### Workflow interpretation

1. **Programme/calendar preparation — OPEN QUESTION:** No official calendar is available in the repository.
2. **Draft — CONFIRMED as a current system state:** The competition lifecycle begins in `DRAFT`.
3. **Review — CONFIRMED as a current system state:** Draft competitions can move to review.
4. **Approval — CONFIRMED as a current system state:** Review can move to approval.
5. **Registration — CONFIRMED as a current system state:** Approved competitions can open registration.
6. **Entry validation — PROPOSED:** Eligibility and duplicate-entry checks should occur before participation is finalized.
7. **Active operation — CONFIRMED as a current system state:** Registered competitions can become active.
8. **Results — CONFIRMED as a current system state:** Active competitions can move to results.
9. **Close/archive — CONFIRMED as a current system state:** Results can close and later be archived while remaining historically retrievable.

## 9. Qualification workflow

The following is an analysis model, not an official rule:

```text
Eligible entry
  → Stage participation
  → Validated result
  → Ranking/award calculation
  → Qualification decision
  → Approval of qualifier list
  → Entry into next stage
```

### Status classification

- **CONFIRMED:** The current requirements call for controlled participation and result recording.
- **PROPOSED:** A validated result may feed a qualification decision and a next-stage entry.
- **OPEN QUESTION:** Whether qualification is automatic, manually approved, quota-based, or invitation-based.
- **OPEN QUESTION:** Whether a winner progresses individually, as a team, or as part of a delegation.
- **OPEN QUESTION:** How ties, withdrawals, substitutions, disqualifications, and appeals affect progression.

## 10. Result and ranking model

### Results

- **CONFIRMED:** NSSMS stores results associated with competitions; the current result payload is flexible JSON-like data.
- **PROPOSED:** A result should identify the event, entry, participant/team, measured value or placing, official status, and validation history.
- **OPEN QUESTION:** Official result units, time/distance/score precision, penalty values, disqualification codes, and record classifications.

### Individual rankings

- **PROPOSED:** Rank individual entries within an event/category/stage using the approved result ordering.
- **OPEN QUESTION:** Whether rank is ordinal only or includes points, records, tie-breakers, and shared places.

### Team rankings

- **PROPOSED:** Rank teams separately from individual athletes, with a transparent event contribution model.
- **OPEN QUESTION:** Whether team ranking is based on medals, points, places, aggregate times, wins, or another technical formula.

### Points and medals

- **OPEN QUESTION:** No official points table or medal-allocation rule is present in the repository.
- **PROPOSED:** Points and medals should be recorded as derived, reviewable awards linked to a validated result/ranking, not entered as unexplained free text.
- **OPEN QUESTION:** Whether medals are awarded at every stage or only at a final stage, and whether team/individual awards coexist.

### Qualification and winner progression

- **PROPOSED:** A winner/progressor record should reference the source event, source result/ranking, destination stage, decision authority, and decision timestamp.
- **OPEN QUESTION:** Whether “winner” and “qualifier” are always the same concept.

## 11. Required data fields (analysis only)

The following fields are candidates for future approved modelling. They are not schema instructions.

### Competition and calendar

- Competition identifier and official title.
- Season identifier.
- Sport and event discipline.
- Stage level and stage sequence.
- Competition type and format.
- Official calendar reference.
- Registration open/close dates.
- Competition start/end dates.
- Result publication date.
- Status and historical version.
- Organizing authority.
- Hosting wilaya, daira, commune, and venue where applicable.

### Category and eligibility

- Gender/category.
- Age category and eligibility cut-off rule.
- School level/year group if applicable.
- Eligibility evidence references.
- Disqualification/ineligibility reason.

### Entries and teams

- Entry identifier.
- Institution identifier.
- Team identifier and team type.
- Athlete/participant identifier.
- Entry status and validation status.
- Withdrawal/substitution history.
- Delegation identifier.

### People and roles

- Athlete identity and institution.
- Coach identity and role.
- Head of delegation identity and authority.
- Official/referee identity, assignment, and validation role.
- Accreditation or appointment reference where an official rule requires it.

### Results and awards

- Event and entry identifiers.
- Raw result value and unit.
- Place/rank.
- Points.
- Medal/award type.
- Record or qualification indicator.
- Validation status and validating official.
- Correction/version history.
- Qualification destination and decision reference.

## 12. Gaps in the current NSSMS domain model

The current implementation contains `seasons`, `competitions`, `participants`, `results`, institutions, licenses, and audit records. It does not currently model:

- Competition stages or geographic stage progression.
- Sports, disciplines, events, or event categories.
- Competition programme/calendar publication.
- Commune/daira/wilaya stage instances.
- Teams and team membership.
- Delegations, coaches, or heads of delegation.
- Officials/referees and assignments.
- Entries/registration submissions as distinct records.
- Qualification decisions and next-stage progression.
- Individual/team rankings.
- Points, medals, awards, tie-breakers, and disqualifications.
- Venue, facility, scheduling, and hosting approval.
- Result validation/versioning beyond the current generic result record.
- Official source documents and technical-rule version references.

These are documented gaps, not implementation requests for this task.

## 13. Database implications — analysis only

No migration is proposed here. If the official references later approve this model, the database analysis will likely need to distinguish:

1. **Programme/calendar data** from individual competition occurrences.
2. **Stages** from competitions so one programme can have multiple geographic levels.
3. **Events/categories** from the competition container.
4. **Entries** from participants and results.
5. **Teams/team members** from individual participants.
6. **Delegations/roles** from ordinary users.
7. **Qualification decisions** from result rows.
8. **Rankings/awards** from raw results and derived calculations.
9. **Venues/hosts** from geographic reference tables.
10. **Technical-rule versions** from current business records so historical results remain interpretable.

The current `results.result_data` flexibility is useful for early exploration but is not, by itself, sufficient to guarantee consistent ranking, points, medal, qualification, or technical-rule semantics at national scale. That conclusion is an analysis observation only.

## 14. API implications — analysis only

No API changes are proposed here. If approved later, the API analysis will likely require separate contracts for:

- Programme/calendar publication.
- Competition-stage creation and hosting.
- Sport/event/category definitions.
- Institution/team/athlete entries.
- Delegation and official assignments.
- Result submission and validation.
- Ranking/points/medal calculation and publication.
- Qualification decisions and next-stage registration.
- Historical result and technical-rule version retrieval.

Each future contract would need explicit role, geographic scope, approval status, idempotency, audit, correction, and public-disclosure rules. Existing lifecycle endpoints must not be assumed to cover these semantics.

## 15. Open decisions

1. Obtain and version the official ministerial competition calendar.
2. Obtain technical competition reports/regulations for each relevant sport.
3. Confirm the official geographic hierarchy and whether commune/daira/wilaya stages are mandatory or optional.
4. Confirm whether zones/regions exist and define their boundaries.
5. Confirm stage names, order, and qualification routes.
6. Confirm official sport, event, gender, and age vocabularies.
7. Confirm individual, team, relay, pair, and mixed formats.
8. Confirm team size, reserves, substitutions, and eligibility evidence.
9. Confirm delegation composition and the authority of coaches/heads of delegation.
10. Confirm official/referee roles, appointment, accreditation, and result-signing authority.
11. Confirm host wilaya selection, venue requirements, and inspection responsibilities.
12. Confirm registration deadlines, withdrawal rules, and late-entry exceptions.
13. Confirm result validation, appeals, corrections, and publication rules.
14. Confirm ranking, points, medals, tie-breakers, and winner/qualifier semantics.
15. Confirm historical record versioning when technical rules or calendar definitions change.
16. Confirm public versus restricted competition data.
17. Confirm whether licenses are required for all entries, only athletes, or selected sports.

## 16. Approval boundary

This document is an analysis artifact only. It does not approve any competition hierarchy, qualification rule, ranking formula, category, role, schema, API, or workflow. No item labelled **PROPOSED** or **OPEN QUESTION** should be implemented as an official NSSMS business rule until the relevant reference documents and authorities approve it.
