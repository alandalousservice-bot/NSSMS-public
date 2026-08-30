-- NSSMS-ARCH-009 corrective migration.
-- Preserves governed team membership history and makes entry archive timestamps database-authoritative.

CREATE OR REPLACE FUNCTION nssms_protect_team_member_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_team_id uuid;
  new_team_id uuid;
  has_historical_entry boolean;
BEGIN
  old_team_id := OLD.team_id;
  new_team_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.team_id END;
  SELECT EXISTS (
    SELECT 1 FROM team_entries team_entry
    JOIN competition_entries entry ON entry.id = team_entry.competition_entry_id
    WHERE team_entry.team_id IN (old_team_id, new_team_id)
      AND entry.status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')
  ) INTO has_historical_entry;

  IF TG_OP = 'DELETE' THEN
    IF has_historical_entry THEN
      RAISE EXCEPTION 'team membership used by historical entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF has_historical_entry AND (
    NEW.team_id IS DISTINCT FROM OLD.team_id OR
    NEW.participant_id IS DISTINCT FROM OLD.participant_id OR
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.valid_from IS DISTINCT FROM OLD.valid_from OR
    NEW.valid_to IS DISTINCT FROM OLD.valid_to
  ) THEN
    RAISE EXCEPTION 'team membership used by historical entries is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER team_members_history_trg ON team_members;
CREATE TRIGGER team_members_history_trg
  BEFORE UPDATE OR DELETE ON team_members FOR EACH ROW EXECUTE FUNCTION nssms_protect_team_member_history();

CREATE OR REPLACE FUNCTION nssms_protect_competition_entry_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  protected_fields_changed boolean;
  archive_transition boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'submitted or historical competition entries cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','SUBMITTED','REJECTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED','VALIDATED','WITHDRAWN','REJECTED')) OR
    (OLD.status = 'VALIDATED' AND NEW.status IN ('VALIDATED','WITHDRAWN','ARCHIVED')) OR
    (OLD.status = 'WITHDRAWN' AND NEW.status IN ('WITHDRAWN','ARCHIVED')) OR
    (OLD.status = 'REJECTED' AND NEW.status IN ('REJECTED','ARCHIVED')) OR
    (OLD.status = 'ARCHIVED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'competition entry lifecycle transitions must be forward-only';
  END IF;
  protected_fields_changed :=
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.institution_id IS DISTINCT FROM OLD.institution_id OR
    NEW.representing_organization_id IS DISTINCT FROM OLD.representing_organization_id OR
    NEW.entry_type IS DISTINCT FROM OLD.entry_type OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.eligibility_data IS DISTINCT FROM OLD.eligibility_data;
  archive_transition := OLD.status IN ('VALIDATED','WITHDRAWN','REJECTED') AND NEW.status = 'ARCHIVED';

  IF archive_transition THEN
    IF protected_fields_changed THEN
      RAISE EXCEPTION 'archiving a competition entry may only transition it to archived';
    END IF;
    IF OLD.archived_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'competition entry archive timestamp is database-controlled';
    END IF;
    NEW.archived_at := now();
  ELSIF OLD.status = 'ARCHIVED' THEN
    IF protected_fields_changed OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'archived competition entries are immutable';
    END IF;
  ELSIF OLD.status IN ('VALIDATED','WITHDRAWN','REJECTED') AND (
    protected_fields_changed OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'validated or historical competition entry identity and context are immutable';
  END IF;
  RETURN NEW;
END;
$$;
