-- NSSMS-ARCH-012 corrective migration: no governed decision provenance on new drafts.

CREATE OR REPLACE FUNCTION nssms_enforce_qualification_creation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'new qualification decisions must begin in DRAFT'; END IF;
  IF NEW.decided_at IS NOT NULL OR NEW.revoked_by_user_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'new draft qualification must not contain governed decision provenance';
  END IF;
  RETURN NEW;
END;
$$;
