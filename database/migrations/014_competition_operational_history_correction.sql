-- NSSMS-ARCH-008 corrective migration.
-- Strengthens operational context, historical immutability, and timing constraints.

CREATE OR REPLACE FUNCTION nssms_validate_competition_stage_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  competition_season_id uuid;
  programme_season_id uuid;
  season_start_date date;
  season_end_date date;
  version_programme_id uuid;
  version_effective_period daterange;
  parent_competition_id uuid;
  parent_programme_id uuid;
  parent_regulation_version_id uuid;
  region_programme_id uuid;
  region_version_id uuid;
BEGIN
  SELECT competition.season_id, season.start_date, season.end_date
    INTO competition_season_id, season_start_date, season_end_date
    FROM competitions competition
    JOIN seasons season ON season.id = competition.season_id
   WHERE competition.id = NEW.competition_id;
  SELECT season_id INTO programme_season_id FROM competition_programmes WHERE id = NEW.programme_id;
  IF competition_season_id IS DISTINCT FROM programme_season_id THEN
    RAISE EXCEPTION 'competition stage programme must belong to the competition season';
  END IF;
  SELECT programme_id, effective_period INTO version_programme_id, version_effective_period
    FROM regulation_versions WHERE id = NEW.regulation_version_id;
  IF version_programme_id IS DISTINCT FROM NEW.programme_id THEN
    RAISE EXCEPTION 'competition stage regulation version must belong to its programme';
  END IF;
  IF NEW.start_date IS NOT NULL AND (NEW.start_date < season_start_date OR NEW.start_date > season_end_date) THEN
    RAISE EXCEPTION 'competition stage start date must fall within the competition season';
  END IF;
  IF NEW.end_date IS NOT NULL AND (NEW.end_date < season_start_date OR NEW.end_date > season_end_date) THEN
    RAISE EXCEPTION 'competition stage end date must fall within the competition season';
  END IF;
  IF NEW.start_date IS NOT NULL AND NOT (NEW.start_date <@ version_effective_period) THEN
    RAISE EXCEPTION 'competition stage start date must fall within the regulation effective period';
  END IF;
  IF NEW.end_date IS NOT NULL AND NOT (NEW.end_date <@ version_effective_period) THEN
    RAISE EXCEPTION 'competition stage end date must fall within the regulation effective period';
  END IF;
  IF NEW.parent_stage_id IS NOT NULL THEN
    SELECT competition_id, programme_id, regulation_version_id
      INTO parent_competition_id, parent_programme_id, parent_regulation_version_id
      FROM competition_stages WHERE id = NEW.parent_stage_id;
    IF parent_competition_id IS DISTINCT FROM NEW.competition_id OR parent_programme_id IS DISTINCT FROM NEW.programme_id THEN
      RAISE EXCEPTION 'parent stage must belong to the same competition and programme';
    END IF;
    IF parent_regulation_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'parent stage must use the same regulation version';
    END IF;
  END IF;
  IF NEW.programme_region_id IS NOT NULL THEN
    SELECT programme_id, regulation_version_id INTO region_programme_id, region_version_id FROM programme_regions WHERE id = NEW.programme_region_id;
    IF region_programme_id IS DISTINCT FROM NEW.programme_id OR region_version_id IS DISTINCT FROM NEW.regulation_version_id THEN
      RAISE EXCEPTION 'programme region must match the stage programme and regulation version';
    END IF;
  END IF;
  PERFORM nssms_validate_competition_geography(NEW.host_wilaya_id, NEW.host_daira_id, NEW.host_commune_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_competition_stage_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE','CLOSED','ARCHIVED') THEN
      RAISE EXCEPTION 'active, closed, or archived competition stages cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('CLOSED','ARCHIVED') THEN
    RAISE EXCEPTION 'closed or archived competition stages are immutable';
  END IF;
  IF OLD.status = 'ACTIVE' AND (
    NEW.competition_id IS DISTINCT FROM OLD.competition_id OR
    NEW.parent_stage_id IS DISTINCT FROM OLD.parent_stage_id OR
    NEW.programme_id IS DISTINCT FROM OLD.programme_id OR
    NEW.programme_region_id IS DISTINCT FROM OLD.programme_region_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.stage_level_code IS DISTINCT FROM OLD.stage_level_code OR
    NEW.host_wilaya_id IS DISTINCT FROM OLD.host_wilaya_id OR
    NEW.host_daira_id IS DISTINCT FROM OLD.host_daira_id OR
    NEW.host_commune_id IS DISTINCT FROM OLD.host_commune_id OR
    NEW.host_organization_id IS DISTINCT FROM OLD.host_organization_id
  ) THEN
    RAISE EXCEPTION 'active competition stage identity and context are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competition_stages_history_trg
  BEFORE UPDATE OR DELETE ON competition_stages
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_competition_stage_history();

ALTER TABLE calendar_occurrences
  ALTER COLUMN start_at SET NOT NULL;

ALTER TABLE calendar_occurrences
  DROP CONSTRAINT calendar_occurrences_registration_dates_ck,
  DROP CONSTRAINT calendar_occurrences_event_dates_ck,
  DROP CONSTRAINT calendar_occurrences_registration_before_event_ck,
  ADD CONSTRAINT calendar_occurrences_registration_dates_ck CHECK (
    (registration_open_at IS NULL OR registration_open_at <= start_at) AND
    (registration_close_at IS NULL OR registration_close_at <= start_at) AND
    (registration_open_at IS NULL OR registration_close_at IS NULL OR registration_open_at <= registration_close_at)
  ),
  ADD CONSTRAINT calendar_occurrences_event_dates_ck CHECK (end_at IS NULL OR end_at > start_at);

CREATE OR REPLACE FUNCTION nssms_protect_calendar_occurrence_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED','PUBLISHED','COMPLETED','ARCHIVED') THEN
      RAISE EXCEPTION 'approved, published, completed, or archived calendar occurrences cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('COMPLETED','ARCHIVED') THEN
    RAISE EXCEPTION 'completed or archived calendar occurrences are immutable';
  END IF;
  IF OLD.status IN ('APPROVED','PUBLISHED') AND (
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
    NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.regulation_source_id IS DISTINCT FROM OLD.regulation_source_id OR
    NEW.registration_open_at IS DISTINCT FROM OLD.registration_open_at OR
    NEW.registration_close_at IS DISTINCT FROM OLD.registration_close_at OR
    NEW.start_at IS DISTINCT FROM OLD.start_at OR
    NEW.end_at IS DISTINCT FROM OLD.end_at
  ) THEN
    RAISE EXCEPTION 'approved or published calendar occurrence context and schedule are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_occurrences_history_trg
  BEFORE UPDATE OR DELETE ON calendar_occurrences
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_calendar_occurrence_history();

ALTER TABLE occurrence_venues
  DROP CONSTRAINT occurrence_venues_dates_ck,
  ADD CONSTRAINT occurrence_venues_dates_ck CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at);
