# NSSMS — Detailed Use Case Specifications

## UC-001 Create Season
**Actor:** Authorized Administrator

### Preconditions
- User is authenticated.
- User has permission within the applicable scope.

### Main Flow
1. User opens season management.
2. User selects create.
3. User enters required data.
4. System validates input.
5. System creates a draft.
6. System records the operation.

### Exceptions
- Missing required data.
- Duplicate season.
- Unauthorized scope.

---

## UC-002 Create Competition
**Actor:** Authorized Administrator

### Preconditions
- A valid season exists.
- User has competition-management permission.

### Main Flow
1. Select season.
2. Create competition.
3. Enter competition data.
4. Validate.
5. Save draft.
6. Audit creation.

---

## UC-003 Issue License
**Actor:** Authorized Operator

### Preconditions
- Participant exists.
- Eligibility requirements are satisfied.

### Main Flow
1. Open participant.
2. Start license application.
3. Validate information.
4. Submit.
5. Approver reviews.
6. License is issued.
7. QR verification identity is created.
8. Audit events are recorded.

---

## UC-004 Verify License
**Actor:** Public User

### Main Flow
1. Scan QR.
2. System resolves verification reference.
3. System checks license status.
4. System returns only approved verification information.

### Security Principle
Verification must not expose private participant data beyond what is officially approved.

---

## UC-005 Review Audit
**Actor:** Authorized Administrator

### Main Flow
1. Open audit.
2. Apply filters.
3. View events.
4. Inspect event details according to permission.

Audit data must be read-only to normal administrative users.
