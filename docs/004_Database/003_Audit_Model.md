# NSSMS — Audit Model

## Purpose
The audit model preserves a trustworthy history of important system operations.

## Minimum Audit Event Concept
An audit event should conceptually contain:
- Event ID.
- Timestamp.
- Actor/User.
- Action.
- Entity type.
- Entity identifier.
- Result/status.
- Context metadata where appropriate.

## Protection
Audit records should be protected from unauthorized modification or deletion.

## Open Decisions
- Exact event retention.
- Whether before/after values are stored.
- Privacy restrictions.
- Storage strategy.
- Reporting requirements.
