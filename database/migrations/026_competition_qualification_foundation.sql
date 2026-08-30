-- NSSMS-ARCH-012: explicit, governed qualification decisions and evidence.

CREATE TABLE qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_entry_id uuid NOT NULL REFERENCES competition_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  destination_stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  destination_entry_id uuid REFERENCES competition_entries(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_version_id uuid NOT NULL REFERENCES regulation_versions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  regulation_source_id uuid REFERENCES regulation_sources(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decision_type text NOT NULL CHECK (decision_type IN ('RESULT_BASED','MANUAL')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED','REVOKED','ARCHIVED')),
  reason text,
  decided_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT qualifications_distinct_stages_ck CHECK (source_stage_id <> destination_stage_id)
);

CREATE TABLE qualification_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_id uuid NOT NULL REFERENCES qualifications(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  result_id uuid NOT NULL REFERENCES results(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  result_validation_id uuid NOT NULL REFERENCES result_validations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qualification_evidence_result_validation_uk UNIQUE (qualification_id, result_id, result_validation_id)
);

CREATE UNIQUE INDEX qualifications_approved_source_destination_uk ON qualifications(source_entry_id,destination_stage_id) WHERE status='APPROVED';
CREATE INDEX qualifications_source_stage_status_idx ON qualifications(source_entry_id,source_stage_id,status);
CREATE INDEX qualifications_destination_stage_status_idx ON qualifications(destination_stage_id,status);
CREATE INDEX qualifications_destination_entry_idx ON qualifications(destination_entry_id) WHERE destination_entry_id IS NOT NULL;
CREATE INDEX qualifications_regulation_status_idx ON qualifications(regulation_version_id,status);
CREATE INDEX qualification_evidence_result_validation_idx ON qualification_evidence(result_id,result_validation_id);

CREATE OR REPLACE FUNCTION nssms_validate_qualification_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_stage uuid; source_category uuid; source_type text; source_version uuid;
  source_competition uuid; destination_competition uuid; destination_programme uuid; destination_version uuid;
  destination_stage uuid; destination_category uuid; destination_type text; destination_version_entry uuid;
  source_subject uuid; destination_subject uuid; is_progression boolean; source_source_version uuid;
BEGIN
  SELECT entry.stage_id, entry.category_id, entry.entry_type, entry.regulation_version_id, stage.competition_id
    INTO source_stage, source_category, source_type, source_version, source_competition
    FROM competition_entries entry JOIN competition_stages stage ON stage.id=entry.stage_id WHERE entry.id=NEW.source_entry_id;
  SELECT competition_id, programme_id, regulation_version_id INTO destination_competition, destination_programme, destination_version FROM competition_stages WHERE id=NEW.destination_stage_id;
  IF source_stage IS DISTINCT FROM NEW.source_stage_id THEN RAISE EXCEPTION 'qualification source entry must belong to its source stage'; END IF;
  IF source_competition IS DISTINCT FROM destination_competition THEN RAISE EXCEPTION 'qualification stages must belong to the same competition'; END IF;
  IF source_version IS DISTINCT FROM NEW.regulation_version_id OR destination_version IS DISTINCT FROM NEW.regulation_version_id THEN RAISE EXCEPTION 'qualification regulation version must match source and destination stages'; END IF;
  WITH RECURSIVE ancestors(id) AS (SELECT parent_stage_id FROM competition_stages WHERE id=NEW.destination_stage_id UNION ALL SELECT stage.parent_stage_id FROM competition_stages stage JOIN ancestors ON stage.id=ancestors.id WHERE ancestors.id IS NOT NULL)
    SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.source_stage_id) INTO is_progression;
  IF NOT is_progression THEN RAISE EXCEPTION 'destination stage must be a configured progression from source stage'; END IF;
  IF NEW.regulation_source_id IS NOT NULL THEN SELECT regulation_version_id INTO source_source_version FROM regulation_sources WHERE id=NEW.regulation_source_id; IF source_source_version IS DISTINCT FROM NEW.regulation_version_id THEN RAISE EXCEPTION 'qualification source provenance must match regulation version'; END IF; END IF;
  IF NEW.destination_entry_id IS NOT NULL THEN
    SELECT stage_id,category_id,entry_type,regulation_version_id INTO destination_stage,destination_category,destination_type,destination_version_entry FROM competition_entries WHERE id=NEW.destination_entry_id;
    IF destination_stage IS DISTINCT FROM NEW.destination_stage_id OR destination_category IS DISTINCT FROM source_category OR destination_type IS DISTINCT FROM source_type OR destination_version_entry IS DISTINCT FROM NEW.regulation_version_id THEN RAISE EXCEPTION 'qualification destination entry context is incompatible'; END IF;
    IF source_type='INDIVIDUAL' THEN SELECT participant_id INTO source_subject FROM individual_entries WHERE competition_entry_id=NEW.source_entry_id; SELECT participant_id INTO destination_subject FROM individual_entries WHERE competition_entry_id=NEW.destination_entry_id; ELSE SELECT team_id INTO source_subject FROM team_entries WHERE competition_entry_id=NEW.source_entry_id; SELECT team_id INTO destination_subject FROM team_entries WHERE competition_entry_id=NEW.destination_entry_id; END IF;
    IF source_subject IS DISTINCT FROM destination_subject THEN RAISE EXCEPTION 'qualification destination entry must preserve the source subject'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_validate_qualification_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q_source uuid; q_stage uuid; q_version uuid; result_entry uuid; result_stage uuid; result_version uuid; validation_result uuid; validation_decision text; validation_revision integer; current_validation uuid; latest_revision integer;
BEGIN
  SELECT source_entry_id,source_stage_id,regulation_version_id INTO q_source,q_stage,q_version FROM qualifications WHERE id=NEW.qualification_id;
  SELECT competition_entry_id,stage_id,regulation_version_id INTO result_entry,result_stage,result_version FROM results WHERE id=NEW.result_id;
  SELECT result_id,decision,revision_no INTO validation_result,validation_decision,validation_revision FROM result_validations WHERE id=NEW.result_validation_id;
  SELECT COALESCE(MAX(revision_no),0) INTO latest_revision FROM result_revisions WHERE result_id=NEW.result_id;
  SELECT validation.id INTO current_validation FROM result_validations validation WHERE validation.result_id=NEW.result_id AND validation.decision IN ('VALIDATED','REJECTED','VOID') AND NOT EXISTS (SELECT 1 FROM result_validations successor WHERE successor.supersedes_validation_id=validation.id) LIMIT 1;
  IF validation_result IS DISTINCT FROM NEW.result_id OR validation_decision<>'VALIDATED' OR current_validation IS DISTINCT FROM NEW.result_validation_id OR validation_revision<>latest_revision THEN RAISE EXCEPTION 'qualification evidence must reference the current validated result decision'; END IF;
  IF result_entry IS DISTINCT FROM q_source OR result_stage IS DISTINCT FROM q_stage OR result_version IS DISTINCT FROM q_version THEN RAISE EXCEPTION 'qualification evidence result must match its source entry, stage, and regulation'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_qualification_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected_changed boolean; evidence_count integer;
BEGIN
  IF TG_OP='DELETE' THEN IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'governed qualification decisions cannot be deleted'; END IF; RETURN OLD; END IF;
  IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','APPROVED','REJECTED','ARCHIVED')) OR (OLD.status='APPROVED' AND NEW.status IN ('APPROVED','REVOKED','ARCHIVED')) OR (OLD.status='REJECTED' AND NEW.status IN ('REJECTED','ARCHIVED')) OR (OLD.status='REVOKED' AND NEW.status IN ('REVOKED','ARCHIVED')) OR (OLD.status='ARCHIVED' AND NEW.status='ARCHIVED')) THEN RAISE EXCEPTION 'qualification lifecycle transitions must be forward-only'; END IF;
  protected_changed := NEW.source_entry_id IS DISTINCT FROM OLD.source_entry_id OR NEW.source_stage_id IS DISTINCT FROM OLD.source_stage_id OR NEW.destination_stage_id IS DISTINCT FROM OLD.destination_stage_id OR NEW.destination_entry_id IS DISTINCT FROM OLD.destination_entry_id OR NEW.regulation_version_id IS DISTINCT FROM OLD.regulation_version_id OR NEW.regulation_source_id IS DISTINCT FROM OLD.regulation_source_id OR NEW.decision_type IS DISTINCT FROM OLD.decision_type OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at;
  IF OLD.status IN ('APPROVED','REJECTED','REVOKED','ARCHIVED') AND protected_changed THEN RAISE EXCEPTION 'governed qualification decision context is immutable'; END IF;
  IF NEW.status='APPROVED' AND OLD.status<>'APPROVED' THEN
    SELECT count(*) INTO evidence_count FROM qualification_evidence WHERE qualification_id=NEW.id;
    IF NEW.decision_type='RESULT_BASED' AND evidence_count=0 THEN RAISE EXCEPTION 'approved result-based qualification requires evidence'; END IF;
    IF NEW.decision_type='MANUAL' AND (NEW.reason IS NULL OR btrim(NEW.reason)='' OR NEW.regulation_source_id IS NULL) THEN RAISE EXCEPTION 'approved manual qualification requires reason and regulation provenance'; END IF;
  END IF;
  IF NEW.status='ARCHIVED' AND OLD.status<>'ARCHIVED' THEN IF protected_changed OR OLD.archived_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION 'qualification archive transition must be status-only and database-controlled'; END IF; NEW.archived_at:=now(); ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN RAISE EXCEPTION 'qualification archival timestamp is database-controlled'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nssms_protect_qualification_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; q_status text;
BEGIN
  target:=CASE WHEN TG_OP='DELETE' THEN OLD.qualification_id ELSE NEW.qualification_id END; SELECT status INTO q_status FROM qualifications WHERE id=target;
  IF q_status IN ('APPROVED','REJECTED','REVOKED','ARCHIVED') THEN RAISE EXCEPTION 'governed qualification evidence is immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER qualifications_context_trg BEFORE INSERT OR UPDATE ON qualifications FOR EACH ROW EXECUTE FUNCTION nssms_validate_qualification_context();
CREATE TRIGGER qualifications_history_trg BEFORE UPDATE OR DELETE ON qualifications FOR EACH ROW EXECUTE FUNCTION nssms_protect_qualification_history();
CREATE TRIGGER qualifications_updated_at BEFORE UPDATE ON qualifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER qualification_evidence_context_trg BEFORE INSERT OR UPDATE ON qualification_evidence FOR EACH ROW EXECUTE FUNCTION nssms_validate_qualification_evidence();
CREATE TRIGGER qualification_evidence_history_trg BEFORE INSERT OR UPDATE OR DELETE ON qualification_evidence FOR EACH ROW EXECUTE FUNCTION nssms_protect_qualification_evidence();
