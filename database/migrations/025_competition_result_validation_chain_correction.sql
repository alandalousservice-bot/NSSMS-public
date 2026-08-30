-- NSSMS-ARCH-011 corrective migration: one current authoritative decision per result.

CREATE OR REPLACE FUNCTION nssms_protect_result_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context_changed boolean; payload_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.governed_status NOT IN ('LEGACY_UNRESOLVED','DRAFT') THEN RAISE EXCEPTION 'governed or historical results cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NOT (
    (OLD.governed_status = 'LEGACY_UNRESOLVED' AND NEW.governed_status = 'LEGACY_UNRESOLVED') OR
    (OLD.governed_status = 'DRAFT' AND NEW.governed_status IN ('DRAFT','SUBMITTED','ARCHIVED')) OR
    (OLD.governed_status = 'SUBMITTED' AND NEW.governed_status IN ('SUBMITTED','VALIDATED','REJECTED','VOID','ARCHIVED')) OR
    (OLD.governed_status IN ('VALIDATED','REJECTED','VOID') AND NEW.governed_status IN ('VALIDATED','REJECTED','VOID','ARCHIVED')) OR
    (OLD.governed_status = 'ARCHIVED' AND NEW.governed_status = 'ARCHIVED')
  ) THEN RAISE EXCEPTION 'result lifecycle transitions must be forward-only through authoritative validation decisions'; END IF;
  IF NEW.governed_status IN ('VALIDATED','REJECTED','VOID') AND NEW.governed_status IS DISTINCT FROM OLD.governed_status AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'result validation status must be established by an immutable validation record';
  END IF;
  context_changed := NEW.competition_id IS DISTINCT FROM OLD.competition_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id OR
    NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id OR NEW.event_id IS DISTINCT FROM OLD.event_id OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.competition_entry_id IS DISTINCT FROM OLD.competition_entry_id OR
    NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR NEW.provenance_source_id IS DISTINCT FROM OLD.provenance_source_id;
  payload_changed := NEW.result_data IS DISTINCT FROM OLD.result_data;
  IF OLD.governed_status IN ('VALIDATED','REJECTED','VOID','ARCHIVED') AND (context_changed OR payload_changed) THEN
    RAISE EXCEPTION 'validated or historical result context and payload are immutable; create a revision';
  END IF;
  IF NEW.governed_status = 'ARCHIVED' AND OLD.governed_status <> 'ARCHIVED' THEN
    IF context_changed OR payload_changed OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'result archive transition must be status-only and database-controlled'; END IF;
    NEW.archived_at := now();
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'result archival timestamp is database-controlled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_result_validation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_no integer; result_status text; current_id uuid;
BEGIN
  SELECT governed_status INTO result_status FROM results WHERE id = NEW.result_id FOR UPDATE;
  SELECT COALESCE(MAX(revision_no), 0) INTO current_no FROM result_revisions WHERE result_id = NEW.result_id;
  IF NEW.revision_no <> current_no THEN RAISE EXCEPTION 'validation must reference the latest committed result revision'; END IF;
  IF NEW.revision_no > 0 AND NOT EXISTS (SELECT 1 FROM result_revisions WHERE result_id=NEW.result_id AND revision_no=NEW.revision_no) THEN RAISE EXCEPTION 'validation must reference the exact committed revision'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.validator_user_id AND status='ACTIVE') THEN RAISE EXCEPTION 'result validator must be an active user'; END IF;
  IF NEW.decision = 'VALIDATED' AND result_status NOT IN ('SUBMITTED','VALIDATED','REJECTED','VOID') THEN RAISE EXCEPTION 'only governed submitted or corrected results may be validated'; END IF;
  IF NEW.supersedes_validation_id IS NOT NULL AND NEW.supersedes_validation_id = NEW.id THEN RAISE EXCEPTION 'a validation cannot supersede itself'; END IF;
  SELECT validation.id INTO current_id FROM result_validations validation
   WHERE validation.result_id = NEW.result_id
     AND validation.decision IN ('VALIDATED','REJECTED','VOID')
     AND NOT EXISTS (SELECT 1 FROM result_validations successor WHERE successor.supersedes_validation_id = validation.id)
   LIMIT 1;
  IF current_id IS NULL AND NEW.supersedes_validation_id IS NOT NULL THEN
    RAISE EXCEPTION 'a first authoritative validation cannot supersede another validation';
  END IF;
  IF current_id IS NOT NULL AND NEW.supersedes_validation_id IS DISTINCT FROM current_id THEN
    RAISE EXCEPTION 'an authoritative validation must explicitly supersede the current authoritative validation';
  END IF;
  RETURN NEW;
END;
$$;

-- The result row is synchronized only by nssms_commit_result_validation; the current ledger row is authoritative.
