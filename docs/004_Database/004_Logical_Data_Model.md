# NSSMS — Logical Data Model

## Core Relationships

### Organization
An organization may contain or govern educational institutions.

### Institution
An institution may have participants and may participate in competitions.

### Participant
A participant belongs to an institution and may have one or more historical license records.

### Season
A season groups competitions and related historical activities.

### Competition
A competition belongs to a season and contains participation/results.

### License
A license belongs to a participant and has a controlled lifecycle.

### QR Verification
A verification reference maps to a license without exposing unauthorized private information.

### Audit Log
An audit event references the actor and the affected business object.

## Integrity Rules
- A competition cannot exist without a valid season.
- A license cannot exist without a participant.
- A participant should have a valid institutional relationship according to business rules.
- Audit events must remain historically available.
- Historical records must not be physically destroyed through normal business operations.
