-- NSSMS-ARCH-010 corrective migration: freeze governed delegation and official history.

CREATE OR REPLACE FUNCTION nssms_protect_delegation_member_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_stage uuid; new_stage uuid; governed boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN SELECT stage_id INTO old_stage FROM delegations WHERE id=OLD.delegation_id; END IF;
  IF TG_OP <> 'DELETE' THEN SELECT stage_id INTO new_stage FROM delegations WHERE id=NEW.delegation_id; END IF;
  governed := COALESCE(nssms_stage_is_governed(old_stage),false) OR COALESCE(nssms_stage_is_governed(new_stage),false);
  IF TG_OP='INSERT' AND governed THEN RAISE EXCEPTION 'delegation membership cannot be added to a governed stage'; END IF;
  IF TG_OP='DELETE' AND governed THEN RAISE EXCEPTION 'governed delegation memberships cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND governed AND (NEW.delegation_id IS DISTINCT FROM OLD.delegation_id OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN RAISE EXCEPTION 'governed delegation membership identity is immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER delegation_members_history_trg ON delegation_members;
CREATE TRIGGER delegation_members_history_trg BEFORE INSERT OR UPDATE OR DELETE ON delegation_members FOR EACH ROW EXECUTE FUNCTION nssms_protect_delegation_member_history();

CREATE OR REPLACE FUNCTION nssms_protect_official_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_governed boolean:=false; new_governed boolean:=false;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_governed := COALESCE(nssms_stage_is_governed(OLD.stage_id),false) OR EXISTS(SELECT 1 FROM calendar_occurrences WHERE id=OLD.occurrence_id AND status IN ('PUBLISHED','COMPLETED','ARCHIVED')); END IF;
  IF TG_OP <> 'DELETE' THEN new_governed := COALESCE(nssms_stage_is_governed(NEW.stage_id),false) OR EXISTS(SELECT 1 FROM calendar_occurrences WHERE id=NEW.occurrence_id AND status IN ('PUBLISHED','COMPLETED','ARCHIVED')); END IF;
  IF TG_OP='INSERT' AND new_governed THEN RAISE EXCEPTION 'official assignment cannot be added to a governed context'; END IF;
  IF TG_OP='DELETE' AND (old_governed OR OLD.status IN ('COMPLETED','ARCHIVED')) THEN RAISE EXCEPTION 'governed official assignments cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND (old_governed OR new_governed OR OLD.status IN ('COMPLETED','ARCHIVED')) AND (NEW.official_id IS DISTINCT FROM OLD.official_id OR NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to) THEN RAISE EXCEPTION 'governed official assignment identity is immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
DROP TRIGGER official_assignments_history_trg ON official_assignments;
CREATE TRIGGER official_assignments_history_trg BEFORE INSERT OR UPDATE OR DELETE ON official_assignments FOR EACH ROW EXECUTE FUNCTION nssms_protect_official_assignment_history();
