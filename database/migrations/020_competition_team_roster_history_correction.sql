-- NSSMS-ARCH-009 final corrective migration.
-- Freezes the full team roster once a team has governed historical participation.

CREATE OR REPLACE FUNCTION nssms_protect_team_member_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_team_id uuid;
  new_team_id uuid;
  has_historical_entry boolean;
BEGIN
  old_team_id := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.team_id END;
  new_team_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.team_id END;
  SELECT EXISTS (
    SELECT 1 FROM team_entries team_entry
    JOIN competition_entries entry ON entry.id = team_entry.competition_entry_id
    WHERE team_entry.team_id IN (old_team_id, new_team_id)
      AND entry.status IN ('VALIDATED','WITHDRAWN','REJECTED','ARCHIVED')
  ) INTO has_historical_entry;

  IF TG_OP = 'INSERT' THEN
    IF has_historical_entry THEN
      RAISE EXCEPTION 'team membership cannot be added after governed historical participation';
    END IF;
    RETURN NEW;
  END IF;
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
  BEFORE INSERT OR UPDATE OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_team_member_history();
