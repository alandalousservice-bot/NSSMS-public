-- NSSMS-ARCH-016-B1-CORR: explicit administrative eligibility is distinct from stage hosting.

CREATE TABLE competition_stage_scope_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES competition_stages(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN ('ORGANIZATION','DAIRA','INSTITUTION')),
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  daira_id integer REFERENCES dairas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  institution_id uuid REFERENCES educational_institutions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competition_stage_scope_eligibility_target_ck CHECK (
    (scope_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND daira_id IS NULL AND institution_id IS NULL) OR
    (scope_type = 'DAIRA' AND organization_id IS NULL AND daira_id IS NOT NULL AND institution_id IS NULL) OR
    (scope_type = 'INSTITUTION' AND organization_id IS NULL AND daira_id IS NULL AND institution_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX competition_stage_scope_eligibility_organization_uk
  ON competition_stage_scope_eligibility(stage_id, organization_id) WHERE scope_type = 'ORGANIZATION';
CREATE UNIQUE INDEX competition_stage_scope_eligibility_daira_uk
  ON competition_stage_scope_eligibility(stage_id, daira_id) WHERE scope_type = 'DAIRA';
CREATE UNIQUE INDEX competition_stage_scope_eligibility_institution_uk
  ON competition_stage_scope_eligibility(stage_id, institution_id) WHERE scope_type = 'INSTITUTION';
CREATE INDEX competition_stage_scope_eligibility_stage_idx ON competition_stage_scope_eligibility(stage_id);

CREATE OR REPLACE FUNCTION nssms_protect_competition_stage_scope_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_stage_status text;
  new_stage_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT status INTO old_stage_status FROM competition_stages WHERE id = OLD.stage_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT status INTO new_stage_status FROM competition_stages WHERE id = NEW.stage_id;
  END IF;

  IF (TG_OP <> 'INSERT' AND old_stage_status IS DISTINCT FROM 'DRAFT')
     OR (TG_OP <> 'DELETE' AND new_stage_status IS DISTINCT FROM 'DRAFT') THEN
    RAISE EXCEPTION 'competition stage eligibility is configurable only while the stage is DRAFT';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER competition_stage_scope_eligibility_draft_only_trg
  BEFORE INSERT OR UPDATE OR DELETE ON competition_stage_scope_eligibility
  FOR EACH ROW EXECUTE FUNCTION nssms_protect_competition_stage_scope_eligibility();
