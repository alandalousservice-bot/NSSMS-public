-- NSSMS-ARCH-012 corrective migration: governed qualifications enter through DRAFT only.

ALTER TABLE qualifications ADD COLUMN revoked_at timestamptz;

CREATE OR REPLACE FUNCTION nssms_enforce_qualification_creation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'DRAFT' THEN RAISE EXCEPTION 'new qualification decisions must begin in DRAFT'; END IF;
  IF NEW.decided_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'qualification decision timestamps are database-controlled'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_qualification_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected_changed boolean; invalid_evidence boolean;
BEGIN
  IF TG_OP='DELETE' THEN IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'governed qualification decisions cannot be deleted'; END IF; RETURN OLD; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','APPROVED','REJECTED','ARCHIVED')) OR (OLD.status='APPROVED' AND NEW.status IN ('APPROVED','REVOKED','ARCHIVED')) OR (OLD.status='REJECTED' AND NEW.status IN ('REJECTED','ARCHIVED')) OR (OLD.status='REVOKED' AND NEW.status IN ('REVOKED','ARCHIVED')) OR (OLD.status='ARCHIVED' AND NEW.status='ARCHIVED')) THEN RAISE EXCEPTION 'qualification lifecycle transitions must be forward-only'; END IF;
  protected_changed := NEW.source_entry_id IS DISTINCT FROM OLD.source_entry_id OR NEW.source_stage_id IS DISTINCT FROM OLD.source_stage_id OR NEW.destination_stage_id IS DISTINCT FROM OLD.destination_stage_id OR NEW.destination_entry_id IS DISTINCT FROM OLD.destination_entry_id OR NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR NEW.regulation_source_id IS DISTINCT FROM OLD.regulation_source_id OR NEW.decision_type IS DISTINCT FROM OLD.decision_type OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id;
  IF OLD.status IN ('APPROVED','REJECTED','REVOKED','ARCHIVED') AND (protected_changed OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'governed qualification decision context is immutable'; END IF;
  IF NEW.status IN ('APPROVED','REJECTED') AND OLD.status='DRAFT' THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.decided_by_user_id AND status='ACTIVE') THEN RAISE EXCEPTION 'qualification decision actor must be active'; END IF;
    NEW.decided_at:=now();
  END IF;
  IF NEW.status='APPROVED' AND OLD.status<>'APPROVED' THEN
    IF NEW.decision_type='MANUAL' AND (NEW.reason IS NULL OR btrim(NEW.reason)='' OR NEW.regulation_source_id IS NULL) THEN RAISE EXCEPTION 'approved manual qualification requires reason and regulation provenance'; END IF;
    IF NEW.decision_type='RESULT_BASED' THEN
      IF NOT EXISTS (SELECT 1 FROM qualification_evidence WHERE qualification_id=NEW.id) THEN RAISE EXCEPTION 'approved result-based qualification requires evidence'; END IF;
      SELECT EXISTS(SELECT 1 FROM qualification_evidence evidence JOIN results result ON result.id=evidence.result_id JOIN result_validations validation ON validation.id=evidence.result_validation_id WHERE evidence.qualification_id=NEW.id AND (validation.result_id IS DISTINCT FROM result.id OR validation.decision<>'VALIDATED' OR result.governed_status<>'VALIDATED' OR result.competition_entry_id IS DISTINCT FROM NEW.source_entry_id OR result.stage_id IS DISTINCT FROM NEW.source_stage_id OR result.regulation_version_id IS DISTINCT FROM NEW.regulation_version_id OR validation.revision_no IS DISTINCT FROM (SELECT COALESCE(MAX(revision_no),0) FROM result_revisions WHERE result_id=result.id) OR EXISTS(SELECT 1 FROM result_validations successor WHERE successor.supersedes_validation_id=validation.id))) INTO invalid_evidence;
      IF invalid_evidence THEN RAISE EXCEPTION 'qualification approval evidence is stale or invalid'; END IF;
    END IF;
  END IF;
  IF NEW.status='REVOKED' AND OLD.status='APPROVED' THEN NEW.revoked_at:=now(); END IF;
  IF NEW.status='ARCHIVED' AND OLD.status<>'ARCHIVED' THEN IF protected_changed OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'qualification archive transition must be status-only and database-controlled'; END IF; NEW.archived_at:=now(); ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN RAISE EXCEPTION 'qualification archival timestamp is database-controlled'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qualifications_creation_state_trg BEFORE INSERT ON qualifications FOR EACH ROW EXECUTE FUNCTION nssms_enforce_qualification_creation_state();
