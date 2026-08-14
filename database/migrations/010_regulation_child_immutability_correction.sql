-- NSSMS-ARCH-006 corrective migration.
-- Replaces the child protection trigger from 009 without rewriting applied history.

CREATE OR REPLACE FUNCTION nssms_protect_regulation_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent_status text;
  new_parent_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO new_parent_status FROM regulation_versions WHERE id = NEW.regulation_version_id;
    IF new_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'rules and sources of published regulation versions are immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT status INTO old_parent_status FROM regulation_versions WHERE id = OLD.regulation_version_id;
    IF old_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'rules and sources of published regulation versions are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO old_parent_status FROM regulation_versions WHERE id = OLD.regulation_version_id;
  IF old_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
    RAISE EXCEPTION 'rules and sources of published regulation versions are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id THEN
    SELECT status INTO new_parent_status FROM regulation_versions WHERE id = NEW.regulation_version_id;
    IF new_parent_status IN ('APPROVED','ACTIVE','RETIRED') THEN
      RAISE EXCEPTION 'rules and sources of published regulation versions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS regulation_rules_immutable_trg ON regulation_rules;
CREATE TRIGGER regulation_rules_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON regulation_rules
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_child();

DROP TRIGGER IF EXISTS regulation_sources_immutable_trg ON regulation_sources;
CREATE TRIGGER regulation_sources_immutable_trg
  BEFORE INSERT OR UPDATE OR DELETE ON regulation_sources
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_regulation_child();
