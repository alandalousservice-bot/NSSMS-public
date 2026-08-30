# NSSMS — Official School Sports Competition Domain Model

**Document status:** Analysis / documentation only — evidence revision pending architecture approval  
**Task:** `NSSMS-ARCH-002-REV1`  
**Scope:** Competition-domain analysis; no application, database, API, workflow, or existing-document changes are implied by this document.

## 0. Evidence basis and certainty rules

This revision was prepared from the NSSMS references plus the following supplied official PDFs (read in full):

- `BILAN-TECHNIQUE-AGO.pdf` (2021–2022 technical balance/report; operational evidence)
- `المنشور الوزاري 1033 رزنامة المنافسة الوطنية المدرسية للرياضات الجماعية.pdf` (Ministerial circular 1033, 20 October 2025; normative calendar/programme evidence)
- `دليل المنافسات الوطنية للرياضة المدرسية المسيلة .pdf` (National School Sports Competition Guide 2025/2026; formally prescriptive guide evidence)

The prior NSSMS reference material remains applicable:

- `docs/001_Business/003_Business_Processes.md`
- `docs/001_Business/007_Organizational_Model.md`
- `docs/001_Business/011_Business_Workflows.md`
- `docs/002_System/006_Functional_Requirements_Detail.md`
- `docs/004_Database/004_Logical_Data_Model.md`
- `docs/000_Project/007_Implementation_Readiness.md`
- `docs/000_Project/001_Project_Charter.md`

The PDFs provide evidence for the 2025/2026 programme and, in the BILAN, observed 2021/2022 operations. They do not establish one timeless rule for every season or sport. The geography archive remains a reference-data source, not a competition rule source.

The labels have the following meaning:

- **NORMATIVE CONFIRMED:** Explicitly required by the ministerial circular or formally prescriptive competition guide, with source/page recorded in the Evidence Matrix.
- **OPERATIONALLY CONFIRMED:** Explicitly evidenced as historical or operational practice in the technical report; it is not automatically a mandatory national rule.
- **SYSTEM-DOMAIN CONFIRMED:** Confirmed by existing NSSMS requirements/implementation, but not claimed as a ministerial or regulatory rule.
- **PROPOSED:** A useful modelling hypothesis that preserves the current project philosophy but requires business/regulatory approval.
- **OPEN QUESTION:** Not sufficiently evidenced to model as a rule.

## 1. Executive conclusion

The supplied ministerial circular and 2025/2026 guide now normatively confirm a staged pathway from institution through commune, daira, wilaya, region, and national competition, with gender and age cohorts and both individual and team sports. The guide also prescribes sport-specific participation, qualification, formats, and technical constraints. The BILAN confirms that historical operations recorded dates, participation totals, event results, rankings, and medals/placements, but those observations remain season/report-specific.

The references still do not provide a single global ranking/points formula, a universal delegation/coach/head-of-delegation model, or venue/official accreditation rules for every sport. Those remain proposed or open and must be versioned by season and discipline.

## 2. Competition hierarchy and stages

### 2.1 Stage hierarchy

| Level or stage | Status | Analysis |
|---|---|---|
| Institution / school | **NORMATIVE CONFIRMED** | The circular and guide begin with institution-level school tournaments (Guide pp. 3–4; Circular pp. 1–2). |
| Commune | **NORMATIVE CONFIRMED** | The guide defines a commune stage between educational institutions within the commune (Guide pp. 3–4). |
| Daira | **NORMATIVE CONFIRMED** | The guide defines a daira stage between institutions directed from the commune stage (Guide pp. 3–4). |
| Wilaya | **NORMATIVE CONFIRMED** | The guide defines a wilaya stage involving athletes/teams qualifying from daira (Guide pp. 3–4). |
| Zone / region | **NORMATIVE CONFIRMED** | The guide defines region stage and an eight-region geographic distribution; regional boundaries are listed (Guide pp. 2, 4–5). |
| National | **NORMATIVE CONFIRMED** | The circular and guide define national finals after regional stages (Circular pp. 2–3; Guide pp. 3–4). |

### 2.2 Competition lifecycle

The existing NSSMS analysis defines the following **PROPOSED** lifecycle:

```text
DRAFT → REVIEW → APPROVED → REGISTRATION → ACTIVE → RESULTS → CLOSED → ARCHIVED
```

The lifecycle is a system-governance state machine, not evidence of a physical competition hierarchy. The exact legal meaning of each state, approval authority, registration closing rule, and result publication rule remains subject to validation.

### 2.3 Qualification between stages

- **NORMATIVE CONFIRMED:** Stage progression exists from institution → commune → daira → wilaya → region → national (Circular pp. 1–3; Guide pp. 3–5).
- **OPERATIONALLY CONFIRMED:** The 2021/2022 BILAN records staged event participation and result/ranking tables, including dates and totals (BILAN pp. 2–26).
- **PROPOSED:** A competition instance should produce explicit qualifier records linking the source stage to the destination stage.
- **OPEN QUESTION:** The exact progression rule is sport/category-specific; the references do not provide one universal winner/ranking/points rule.
- **NORMATIVE CONFIRMED:** Individual qualification exists for applicable individual disciplines, and team qualification exists for applicable collective disciplines (Guide pp. 8–9, 19–20, 29–33).
- **OPEN QUESTION:** The exact qualification method, quota, tie-breaker, and approval path remain sport/category/season-specific.
- **OPEN QUESTION:** Whether a participant may qualify in multiple sports or stages in the same calendar period.

## 3. Competition scope: sport, gender, age, and format

### 3.1 Individual and team sports

- **NORMATIVE CONFIRMED:** The programme includes both collective sports (football, handball, basketball 5x5/3x3, volleyball) and individual sports (athletics, swimming, table tennis, judo, karate, taekwondo, wrestling, chess, etc.) (Circular p. 1; Guide pp. 2, 7–34).
- **NORMATIVE CONFIRMED:** The guide defines team sizes and match formats per sport, rather than one global team size (Guide pp. 20–23, 25–28, 34).
- **OPERATIONALLY CONFIRMED:** The BILAN contains individual event results and ranked tables for athletics (BILAN pp. 12–26).
- **PROPOSED:** Each competition event should declare a format: `INDIVIDUAL`, `TEAM`, or `MIXED`.
- **PROPOSED:** Individual events should produce participant entries and individual rankings; team events should produce team entries and team rankings while retaining athlete membership.
- **OPEN QUESTION:** Whether reserve eligibility and substitution rules are globally reusable; the guide gives sport-specific arrangements.

### 3.2 Male and female categories

- **NORMATIVE CONFIRMED:** The programme is organised for both males and females across the educational stages and age cohorts (Circular pp. 1–3; Guide pp. 3, 6).
- **NORMATIVE CONFIRMED:** Some competitions explicitly separate male/female entries and team tables; this separation is sport-specific, not evidence of a universal mixed-event rule (Guide pp. 8–9, 19–23).
- **PROPOSED:** Gender/category must be an explicit property of an event or competition class, not inferred from a participant name or institution.
- **OPEN QUESTION:** The approved system vocabulary and exceptions for mixed participation.

### 3.3 Age and category concepts

- **NORMATIVE CONFIRMED (2025/2026 baseline):** The guide maps cohorts by birth year: primary/schools 2015–2017, middle/buds 2013–2014, younger 2011–2012, and cadets 2008–2010; the guide notes that some categories may be adjusted for international specifications (Guide p. 6).
- **NORMATIVE CONFIRMED:** Individual sports may define additional sport-specific birth-year and weight/technical classes (Guide pp. 10, 14–17).
- **PROPOSED:** An event should reference an approved age/category definition, with an effective date or cut-off date for eligibility calculation.
- **OPEN QUESTION:** Whether the 2025/2026 birth-year ranges persist in later seasons and how exceptions are approved.

## 4. Actors

| Actor | Status | Responsibility in the model |
|---|---|---|
| National administration | **SYSTEM-DOMAIN CONFIRMED** | National configuration, season governance, competition oversight, policy, and reporting are identified in the organizational model. Exact legal authority remains open. |
| Wilaya/association administration | **PROPOSED** | Regional competition administration, local validation, monitoring, and reporting. The documents explicitly call these potential responsibilities. |
| Daira supervisor | **PROPOSED** | Local geographic coordination and review within a daira. The role exists in implementation, but competition-specific authority is not defined by the supplied business references. |
| Educational institution/school | **SYSTEM-DOMAIN CONFIRMED** | Maintains participant information and may participate in competitions. |
| Athlete/participant | **SYSTEM-DOMAIN CONFIRMED** | A participant belongs to an institution and may hold historical license records. Competition eligibility is still rule-dependent. |
| Coach | **NORMATIVE CONFIRMED (sport-specific)** | Team/delegation tables prescribe coaches/trainers in several team sports (Guide pp. 27–28, 31, 34). This is not a universal composition rule. |
| Head of delegation | **NORMATIVE CONFIRMED (sport/event-specific)** | The guide lists a head of delegation in the athletics delegation composition (Guide p. 27) and delegation tables; applicability varies by event. |
| Competition official/referee | **NORMATIVE CONFIRMED (operational roles)** | The guide allocates refereeing/judging and technical/organising committees for events (Guide pp. 9, 12, 27–28); the BILAN records officials/judging totals (BILAN pp. 11–12). Accreditation rules remain open. |
| Host/organizing wilaya | **NORMATIVE CONFIRMED (programme responsibility)** | Wilaya associations organise wilaya stages and national federation/association bodies organise listed national events (Circular pp. 1–3; Guide pp. 3–4, 13). Specific host selection is open. |
| Venue operator | **PROPOSED** | A venue is required operationally, but ownership/inspection/booking responsibilities are not prescribed globally. |
| Public verifier | **SYSTEM-DOMAIN CONFIRMED** for license verification only | The public portal supports public license verification; public competition-result visibility is not fully specified. |

## 5. Entities

### 5.1 SYSTEM-DOMAIN CONFIRMED or existing NSSMS entities

- **Season:** Groups competitions and related historical activities.
- **Competition:** Belongs to a season and contains participation/results.
- **Organization:** May govern institutions.
- **Educational institution:** Has participants and may participate in competitions.
- **Participant/athlete:** Belongs to an institution and may have historical licenses.
- **Result:** Records competition result data and may reference a participant.
- **Audit event:** Records actor, time, action, and affected object.

### 5.2 Competition-domain concepts and representation status

The following concepts are supported by the official evidence where marked **NORMATIVE CONFIRMED**. Representing any concept as a standalone database entity/table remains **PROPOSED** unless it is already an NSSMS entity.

- **Competition programme:** **NORMATIVE CONFIRMED** concept; standalone entity/table **PROPOSED**.
- **Competition stage:** **NORMATIVE CONFIRMED** concept; standalone entity/table **PROPOSED**.
- **Sport/event/category:** **NORMATIVE CONFIRMED** concepts; standalone entities/tables **PROPOSED**.
- **Entry:** **NORMATIVE CONFIRMED** participation concept; standalone entity/table **PROPOSED**.
- **Team:** **NORMATIVE CONFIRMED** for applicable collective sports; standalone entity/table **PROPOSED**.
- **Delegation:** **NORMATIVE CONFIRMED** in documented event compositions; standalone entity/table **PROPOSED**.
- **Coach:** **NORMATIVE CONFIRMED** where prescribed for a named sport/event; standalone entity/table **PROPOSED**.
- **Head of delegation:** **NORMATIVE CONFIRMED** where prescribed for a named event; standalone entity/table **PROPOSED**.
- **Official/referee:** **NORMATIVE CONFIRMED** as an operational role; standalone entity/table **PROPOSED**.
- **Venue:** A place hosting an event, subject to official venue requirements.
- **Qualification:** **NORMATIVE CONFIRMED** progression concept; standalone entity/table **PROPOSED**.
- **Ranking:** **OPERATIONALLY CONFIRMED** in the BILAN and **NORMATIVE CONFIRMED** where the guide specifies ordered qualifiers; standalone entity/table **PROPOSED**.
- **Award:** **NORMATIVE CONFIRMED** where medals/trophies/certificates are prescribed; standalone entity/table **PROPOSED**.
- **Calendar occurrence:** A dated competition/stage window from an approved calendar.

## 6. Relationships

### 6.1 SYSTEM-DOMAIN CONFIRMED relationships

```text
Season 1 ──< Competition
Organization 1 ──< EducationalInstitution
EducationalInstitution 1 ──< Participant
Participant 1 ──< SportsLicense
Competition 1 ──< Result
Result ──> Participant (optional in the current schema)
AuditEvent ──> Actor and affected business object
```

These relationships are explicitly represented in the logical data model and/or current NSSMS schema. Their current representation is system-domain evidence, not a ministerial rule.

### 6.2 Officially evidenced concepts versus architectural representation

The references confirm the existence of the following relationships/concepts, while a standalone table/entity representation remains **PROPOSED**:

| Concept/relationship | Evidence status | Standalone entity/table representation |
|---|---|---|
| Competition → CompetitionStage | **NORMATIVE CONFIRMED** | **PROPOSED** |
| CompetitionStage → Event | **NORMATIVE CONFIRMED** | **PROPOSED** |
| Event → Entry | **NORMATIVE CONFIRMED** | **PROPOSED** |
| Entry → Institution/Team/Participant | **NORMATIVE CONFIRMED** | **PROPOSED** |
| Team → Participant membership | **NORMATIVE CONFIRMED** for collective sports | **PROPOSED** |
| Delegation → members/roles | **NORMATIVE CONFIRMED** where prescribed | **PROPOSED** |
| CompetitionStage → host/venue | **NORMATIVE CONFIRMED** as an operational need; host/venue rules are incomplete | **PROPOSED** |
| Entry/result → Qualification → next stage | **NORMATIVE CONFIRMED** progression concept | **PROPOSED** |
| Event → Result → Ranking | **OPERATIONALLY CONFIRMED** and **NORMATIVE CONFIRMED** where specified | **PROPOSED** |
| Result/Ranking → Award | **NORMATIVE CONFIRMED** where medals/trophies/certificates are prescribed | **PROPOSED** |

### 6.3 Proposed conceptual relationship graph

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

The graph is an architectural interpretation only. It must not be treated as a schema or implementation decision without approval.

## 7. Business rules

### NORMATIVE CONFIRMED by supplied official references

1. The 2025/2026 programme is staged through institution, commune, daira, wilaya, region, and national levels.
2. The programme includes individual and collective sports, and male/female participation across educational stages.
3. The guide defines season-specific birth-year cohorts and sport-specific event/team constraints.
4. Qualification is described between stages, but the exact method is dependent on the sport/category and published tables.
5. Official stages have prescribed calendar windows for 2025/2026.

### OPERATIONALLY CONFIRMED by the technical report

1. The 2021/2022 BILAN records dated competition operations, participation totals, event-level results, and ranked standings.
2. The BILAN records individual athletics performances and placements, including event measurements and rank order.
3. The BILAN records medal/placement-style outputs and aggregate tables for the reported season.

### CONFIRMED by current NSSMS references (system-domain facts)

1. A competition belongs to a season.
2. Authorized users manage competitions and participation.
3. Authorized officials may record results.
4. Closed competitions remain historically accessible.
5. Institutions are related to participants.
6. Participant eligibility must be validated according to approved rules.
7. Audit events must preserve actor and timestamp information and remain historically available.
8. The system must avoid normal physical deletion of governed records.

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

The NSSMS workflow remains a system governance skeleton, while the physical competition progression is **NORMATIVE CONFIRMED for the 2025/2026 programme**:

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

1. **Programme/calendar preparation — NORMATIVE CONFIRMED:** The ministerial circular and guide publish the 2025/2026 calendar (Circular pp. 1–3; Guide pp. 3–4).
2. **Draft — SYSTEM-DOMAIN CONFIRMED:** The competition lifecycle begins in `DRAFT`.
3. **Review — SYSTEM-DOMAIN CONFIRMED:** Draft competitions can move to review.
4. **Approval — SYSTEM-DOMAIN CONFIRMED:** Review can move to approval.
5. **Registration — SYSTEM-DOMAIN CONFIRMED:** Approved competitions can open registration.
6. **Entry validation — PROPOSED:** Eligibility and duplicate-entry checks should occur before participation is finalized.
7. **Active operation — SYSTEM-DOMAIN CONFIRMED:** Registered competitions can become active.
8. **Results — SYSTEM-DOMAIN CONFIRMED:** Active competitions can move to results.
9. **Close/archive — SYSTEM-DOMAIN CONFIRMED:** Results can close and later be archived while remaining historically retrievable.

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

- **NORMATIVE CONFIRMED:** Qualifying participants/teams move through the geographic stages; the guide explicitly names stage winners/qualifiers and national entry lists (Guide pp. 8–9, 19–20, 29–33).
- **OPERATIONALLY CONFIRMED:** The BILAN shows result and ranking tables produced during an historical season (BILAN pp. 2–26).
- **PROPOSED:** A validated result should feed an explicit qualification decision and next-stage entry record.
- **OPEN QUESTION:** Whether qualification is automatic, manually approved, quota-based, or invitation-based outside the sport-specific rules stated in the guide.
- **NORMATIVE CONFIRMED:** Individual qualification exists for applicable individual disciplines; team qualification exists for applicable collective disciplines.
- **OPEN QUESTION:** Exact quotas/formulas, ties, withdrawals, substitutions, disqualifications, appeals, and whether a delegation carries one or multiple qualified entries remain sport/category/season-specific.

## 10. Result and ranking model

### Results

- **SYSTEM-DOMAIN CONFIRMED:** NSSMS stores results associated with competitions; the current result payload is flexible JSON-like data.
- **OPERATIONALLY CONFIRMED:** The BILAN records measured athletics values, places, and event-specific result tables (BILAN pp. 12–26).
- **PROPOSED:** A result should identify the event, entry, participant/team, measured value or placing, official status, and validation history.
- **OPEN QUESTION:** Official result units, time/distance/score precision, penalty values, disqualification codes, and record classifications.

### Individual rankings

- **OPERATIONALLY CONFIRMED:** Individual event rankings and placements are produced in the BILAN (BILAN pp. 12–26).
- **PROPOSED:** Rank individual entries within an event/category/stage using the approved result ordering.
- **OPEN QUESTION:** Whether rank is ordinal only or includes points, records, tie-breakers, and shared places in future seasons.

### Team rankings

- **PROPOSED:** Rank teams separately from individual athletes, with a transparent event contribution model.
- **OPEN QUESTION:** Whether team ranking is based on medals, points, places, aggregate times, wins, or another technical formula.

### Points and medals

- **NORMATIVE CONFIRMED (sport/season-specific):** The guide prescribes medals/certificates for top individual places and challenge trophies for wilayas in the road-race sections (Guide pp. 30, 33).
- **OPERATIONALLY CONFIRMED:** The BILAN contains medal/placement and aggregate standings for the reported 2021/2022 events (BILAN pp. 2–26).
- **OPEN QUESTION:** No universal points table or medal-allocation rule is established across all sports and seasons.
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

1. Define how future-season calendars, stage boundaries, cohorts, and technical regulations are versioned.
2. Confirm exact sport/category-specific qualification formulas, quotas, and tie-breakers.
3. Confirm replacement, withdrawal, substitution, disqualification, and late-entry rules.
4. Confirm appeals, result corrections, validation authority, and deadlines.
5. Confirm technical accreditation, appointment, and result-signing rules for officials/referees.
6. Confirm host-wilaya selection, venue inspection, and facility responsibility rules.
7. Define the canonical system vocabulary for sports, events, gender, age, stages, entries, rankings, and awards.
8. Confirm mixed-event rules and exceptional eligibility, including international-alignment exceptions.
9. Confirm whether delegation composition and coach/head-of-delegation authority vary by sport or stage.
10. Confirm publication/privacy policy for participant identities, results, rankings, and historical reports.
11. Confirm whether licenses are required for all entries, only athletes, or selected sports.

## 16. Evidence Matrix

| Rule / Concept | Source document | Page or section | Evidence class | Confidence | Architectural impact |
|---|---|---|---|---|---|
| Institution → commune → daira → wilaya → region → national stages | Ministerial circular 1033; National Guide | Circular pp. 1–3; Guide pp. 3–4 | NORMATIVE CONFIRMED | High for 2025/2026 | Model stage sequence and qualification edges as season-versioned data. |
| Eight geographic regions and wilaya membership | National Guide | pp. 2, 5 | NORMATIVE CONFIRMED | High for 2025/2026 | Do not hard-code region membership globally; version by programme. |
| Both individual and collective sports | Circular; National Guide | Circular p. 1; Guide pp. 2, 7–34 | NORMATIVE CONFIRMED | High | Event format must be sport/event-specific. |
| Male/female participation | Circular; National Guide | Circular pp. 1–3; Guide pp. 3, 6, 8–9 | NORMATIVE CONFIRMED | High | Gender/category is an explicit event dimension. |
| Birth-year cohorts 2015–2017, 2013–2014, 2011–2012, 2008–2010 | National Guide | p. 6 | NORMATIVE CONFIRMED | High for 2025/2026 | Store effective season/category rules; do not generalize to all seasons. |
| Sport-specific ages, weights, distances and team sizes | National Guide | pp. 10–18, 22–34 | NORMATIVE CONFIRMED | High within named sport | Technical rules require discipline/version scoping. |
| Regional and national qualification | Ministerial circular; National Guide | Circular pp. 2–3; Guide pp. 8–9, 19–20, 29–33 | NORMATIVE CONFIRMED | High for named programme | Qualification is a first-class, source-to-destination record. |
| National 3x3 stage: eight wilaya and eight regional selections | National Guide | pp. 8–9 | NORMATIVE CONFIRMED | High for 3x3 2026 | Do not make this quota global to every sport. |
| Participation counts and delegation composition | National Guide | pp. 11–12, 18, 27, 31 | NORMATIVE CONFIRMED | High for named events | Model entry/delegation counts as event-specific constraints. |
| Referees/judges and technical/organising committees | National Guide | pp. 9, 12, 27–28 | NORMATIVE CONFIRMED | Medium–high | Officials and assignments need explicit roles; accreditation remains open. |
| Dates for staged 2025/2026 calendar | Ministerial circular; National Guide | Circular pp. 1–3; Guide pp. 3–4 | NORMATIVE CONFIRMED | High for 2025/2026 | Calendar occurrences must be season-versioned. |
| Historical measured results and ranked standings | BILAN TECHNIQUE AGO | pp. 2–26, dated 2022 entries | OPERATIONALLY CONFIRMED | High for 2021/2022 report | Preserve raw measurements, placing, date, and report provenance. |
| Historical aggregate/medal-style standings | BILAN TECHNIQUE AGO | pp. 2–26 | OPERATIONALLY CONFIRMED | Medium–high | Store report-specific aggregates without treating them as universal scoring. |
| Universal points formula | All three references | Not stated globally | OPEN QUESTION | High | No global points engine should be assumed. |
| Universal delegation, venue and official accreditation rules | All three references | Not stated globally | OPEN QUESTION | High | Require sport/season policy before implementation. |

## 17. Contradictions, scope limits, and versioning

### Differences between normative rules and observed practice

- The 2025/2026 circular/guide prescribe a six-level competition pathway and sport-specific participation rules; the 2021/2022 BILAN is an operational report of completed activities and cannot by itself prove that the same pathway or quotas were mandatory in 2021/2022.
- The guide prescribes current birth-year cohorts and technical formats, while the BILAN reports historical results using its own event tables. Historical values must retain their source season and technical-rule version.

### Contradictions or apparent tensions

- The guide's general age table (p. 6) and individual sport tables (pp. 10, 14–17) use different sport-specific cohorts/weights. This is a scope distinction, not a basis for one global age/weight rule.
- The guide describes eight regions, while the circular describes a regional stage without restating all boundaries. The guide's named 2025/2026 distribution is authoritative for that programme only.
- The BILAN's participation totals and ranking tables do not match the 2025/2026 guide's quotas because they describe a different season/report; no contradiction should be inferred without a same-season rule set.

### Season-specific and sport-specific rules that must not be generalized

- 2025/2026 calendar dates, birth-year ranges, regional grouping, quotas, team sizes, match durations, distances, weights, and medal/trophy provisions.
- 3x3 basketball's eight-wilaya/eight-region national format, athletics event quotas, combat-sport weight classes, and football/handball/volleyball roster sizes.
- Any BILAN 2021/2022 participation count, ranking, medal total, or event result.

All such values require a season/regulation/discipline version reference in any future approved model.

### Architectural principle

**Regulations are versioned configuration, not hard-coded global business rules.** Calendar dates, birth-year cohorts, regional grouping, quotas, team sizes, weights, distances, qualification formulas, and medal/award rules must be associated with a season, programme, or technical-rule version whenever applicable. A value observed in one season or discipline must not silently become a global invariant.

## 18. Approval boundary

This document is an analysis artifact only. It does not approve any competition hierarchy, qualification rule, ranking formula, category, role, schema, API, or workflow. No item labelled **PROPOSED** or **OPEN QUESTION** should be implemented as an official NSSMS business rule until the relevant reference documents and authorities approve it.
