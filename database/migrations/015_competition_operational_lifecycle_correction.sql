-- NSSMS-ARCH-008 final corrective migration.
-- Makes stage and occurrence lifecycle transitions forward-only without weakening history protection.

CREATE OR REPLACE FUNCTION nssms_protect_competition_stage_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  protected_fields_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('ACTIVE','RESULTS','CLOSED','ARCHIVED') THEN
      RAISE EXCEPTION 'active, results, closed, or archived competition stages cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','SCHEDULED')) OR
    (OLD.status = 'SCHEDULED' AND NEW.status IN ('SCHEDULED','ACTIVE')) OR
    (OLD.status = 'ACTIVE' AND NEW.status IN ('ACTIVE','RESULTS')) OR
    (OLD.status = 'RESULTS' AND NEW.status IN ('RESULTS','CLOSED')) OR
    (OLD.status = 'CLOSED' AND NEW.status IN ('CLOSED','ARCHIVED')) OR
    (OLD.status = 'ARCHIVED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'competition stage lifecycle transitions must be forward-only';
  END IF;

  protected_fields_changed :=
    NEW.competition_id IS DISTINCT FROM OLD.competition_id OR
    NEW.parent_stage_id IS DISTINCT FROM OLD.parent_stage_id OR
    NEW.programme_id IS DISTINCT FROM OLD.programme_id OR
    NEW.programme_region_id IS DISTINCT FROM OLD.programme_region_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.stage_level_code IS DISTINCT FROM OLD.stage_level_code OR
    NEW.host_wilaya_id IS DISTINCT FROM OLD.host_wilaya_id OR
    NEW.host_daira_id IS DISTINCT FROM OLD.host_daira_id OR
    NEW.host_commune_id IS DISTINCT FROM OLD.host_commune_id OR
    NEW.host_organization_id IS DISTINCT FROM OLD.host_organization_id;

  IF OLD.status IN ('ACTIVE','RESULTS') AND protected_fields_changed THEN
    RAISE EXCEPTION 'active or results competition stage identity and context are immutable';
  END IF;
  IF OLD.status = 'CLOSED' AND NEW.status = 'ARCHIVED' AND (
    protected_fields_changed OR NEW.start_date IS DISTINCT FROM OLD.start_date OR
    NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'closing a competition stage may only transition it to archived';
  END IF;
  IF OLD.status IN ('CLOSED','ARCHIVED') AND NEW.status = OLD.status AND (
    protected_fields_changed OR NEW.start_date IS DISTINCT FROM OLD.start_date OR
    NEW.end_date IS DISTINCT FROM OLD.end_date OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'closed or archived competition stages are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_calendar_occurrence_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  protected_fields_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED','PUBLISHED','COMPLETED','ARCHIVED') THEN
      RAISE EXCEPTION 'approved, published, completed, or archived calendar occurrences cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT','APPROVED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED','PUBLISHED')) OR
    (OLD.status = 'PUBLISHED' AND NEW.status IN ('PUBLISHED','COMPLETED')) OR
    (OLD.status = 'COMPLETED' AND NEW.status IN ('COMPLETED','ARCHIVED')) OR
    (OLD.status = 'ARCHIVED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'calendar occurrence lifecycle transitions must be forward-only';
  END IF;

  protected_fields_changed :=
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR
    NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR
    NEW.regulation_source_id IS DISTINCT FROM OLD.regulation_source_id OR
    NEW.registration_open_at IS DISTINCT FROM OLD.registration_open_at OR
    NEW.registration_close_at IS DISTINCT FROM OLD.registration_close_at OR
    NEW.start_at IS DISTINCT FROM OLD.start_at OR
    NEW.end_at IS DISTINCT FROM OLD.end_at;

  IF OLD.status IN ('APPROVED','PUBLISHED') AND protected_fields_changed THEN
    RAISE EXCEPTION 'approved or published calendar occurrence context and schedule are immutable';
  END IF;
  IF OLD.status = 'COMPLETED' AND NEW.status = 'ARCHIVED' AND (
    protected_fields_changed OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'completing a calendar occurrence may only transition it to archived';
  END IF;
  IF OLD.status IN ('COMPLETED','ARCHIVED') AND NEW.status = OLD.status AND (
    protected_fields_changed OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) THEN
    RAISE EXCEPTION 'completed or archived calendar occurrences are immutable';
  END IF;
  RETURN NEW;
END;
$$;
