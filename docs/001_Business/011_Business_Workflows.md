# NSSMS — Business Workflow Specifications

## Workflow WF-01 — Season

### Goal
Establish a controlled sports season.

### Proposed States
`DRAFT → UNDER_REVIEW → APPROVED → ACTIVE → CLOSED → ARCHIVED`

### Key Controls
- Only authorized users create/modify.
- Activation requires approval.
- Closed seasons become historical.
- Archived seasons remain retrievable.

### Open Questions
- Can an approved season be edited?
- Who can reopen a season?
- Are overlapping seasons allowed?

---

## Workflow WF-02 — Competition

### Proposed States
`DRAFT → REVIEW → APPROVED → REGISTRATION → ACTIVE → RESULTS → CLOSED → ARCHIVED`

### Key Controls
- Competition belongs to a season.
- Competition scope must be defined.
- Results become historical after closure.

---

## Workflow WF-03 — Digital License

### Proposed States
`APPLICATION → VALIDATION → APPROVAL → ISSUED → ACTIVE → EXPIRED / SUSPENDED → ARCHIVED`

### Key Controls
- Eligibility must be validated.
- License identity must be unique.
- QR verification must reflect current status.

---

## Workflow WF-04 — Public Publication

`INTERNAL → REVIEW → APPROVED → PUBLISHED → ARCHIVED`

Public data must be explicitly approved for publication.

## Important
All state machines in this document are **proposed analysis models**, not final legal workflows.
