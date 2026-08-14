# NSSMS — State Machines

## Season

```text
DRAFT
  │ submit
  ▼
UNDER_REVIEW
  ├── reject ──> DRAFT
  └── approve
          ▼
       APPROVED
          │ activate
          ▼
        ACTIVE
          │ close
          ▼
        CLOSED
          │ archive
          ▼
       ARCHIVED
```

## Competition

```text
DRAFT → REVIEW → APPROVED → REGISTRATION → ACTIVE
                                      │
                                      ▼
                                    RESULTS
                                      │
                                      ▼
                                    CLOSED
                                      │
                                      ▼
                                   ARCHIVED
```

## License

```text
APPLICATION → VALIDATION → APPROVAL → ISSUED → ACTIVE
                                      │
                                      ├── expire → EXPIRED
                                      └── suspend → SUSPENDED
```

## Rules
- Only valid transitions are permitted.
- Each transition must identify the actor.
- Sensitive transitions should generate audit events.
- Final states remain historically accessible.
