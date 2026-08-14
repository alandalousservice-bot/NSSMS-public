# NSSMS — Initial Data Dictionary

## Season
| Field | Purpose | Required |
|---|---|---|
| id | Unique identifier | Yes |
| name | Display name | Yes |
| start_date | Start | Yes |
| end_date | End | Yes |
| status | Lifecycle state | Yes |
| created_at | Creation timestamp | Yes |
| updated_at | Update timestamp | Yes |

## Competition
| Field | Purpose | Required |
|---|---|---|
| id | Unique identifier | Yes |
| season_id | Parent season | Yes |
| name | Competition name | Yes |
| status | Lifecycle state | Yes |
| start_date | Start | TBD |
| end_date | End | TBD |

## Participant
| Field | Purpose | Required |
|---|---|---|
| id | Unique identifier | Yes |
| institution_id | Institution | Yes |
| status | Participant state | Yes |

## Sports License
| Field | Purpose | Required |
|---|---|---|
| id | License identifier | Yes |
| participant_id | Participant | Yes |
| status | License state | Yes |
| issued_at | Issue timestamp | TBD |
| expires_at | Expiry | TBD |
| verification_reference | QR verification reference | Yes |

This dictionary is intentionally incomplete until official business data requirements are validated.
