# NSSMS — Database Security

## Principles
- Least privilege.
- Separation of application and administrative database access.
- Protected credentials.
- Encryption where required.
- Audit-sensitive operations.
- Backup protection.
- Recovery testing.

## Application Access
The application should not use unrestricted database credentials.

## Audit Data
Audit records require stronger protection than ordinary mutable operational data.

## Backup
Backups must be:
- Access controlled.
- Protected from unauthorized modification.
- Tested for restoration.
- Governed by approved retention policy.
