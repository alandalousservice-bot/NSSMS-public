import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const enabled = Boolean(process.env.DATABASE_URL); const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
async function fails(c: pg.PoolClient, fn: () => Promise<unknown>, rx?: RegExp) { await c.query('SAVEPOINT expected_failure'); try { await fn(); } catch (e) { await c.query('ROLLBACK TO SAVEPOINT expected_failure'); await c.query('RELEASE SAVEPOINT expected_failure'); if (rx) expect(String((e as Error).message)).toMatch(rx); return; } await c.query('ROLLBACK TO SAVEPOINT expected_failure'); await c.query('RELEASE SAVEPOINT expected_failure'); throw new Error('Expected failure'); }

suite('competition results validation foundation', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); }); afterAll(async () => { await pool?.end(); });
  it('preserves legacy results without fabricating governed context', async () => {
    const c = await pool!.connect(); try { await c.query('BEGIN');
      const season=(await c.query("INSERT INTO seasons(name,start_date,end_date) VALUES('RESULT LEGACY','2092-01-01','2092-12-31') RETURNING id")).rows[0].id;
      const competition=(await c.query("INSERT INTO competitions(season_id,name) VALUES($1,'Legacy Results') RETURNING id",[season])).rows[0].id;
      const legacy=(await c.query("INSERT INTO results(competition_id,result_data) VALUES($1,'{\"placing\":1}'::jsonb) RETURNING id,governed_status,result_data",[competition])).rows[0];
      expect(legacy.governed_status).toBe('LEGACY_UNRESOLVED'); expect(legacy.result_data).toEqual({ placing: 1 });
      await fails(c,()=>c.query("UPDATE results SET stage_id=gen_random_uuid() WHERE id=$1",[legacy.id]),/legacy unresolved/);
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });

  it('enforces governed result context, lifecycle, revisions, validations, and archival history', async () => {
    const c = await pool!.connect(); try { await c.query('BEGIN');
      const org=(await c.query("INSERT INTO organizations(name,code) VALUES('Results Org','RESULTS-ORG') RETURNING id")).rows[0].id;
      const ins=(await c.query("INSERT INTO educational_institutions(organization_id,name,code) VALUES($1,'Results Institution','RESULTS-INS') RETURNING id",[org])).rows[0].id;
      const participant=(await c.query("INSERT INTO participants(institution_id,given_name,family_name) VALUES($1,'Result','Athlete') RETURNING id",[ins])).rows[0].id;
      const validator=(await c.query("INSERT INTO users(username,display_name) VALUES('result.validator','Result Validator') RETURNING id")).rows[0].id;
      const season=(await c.query("INSERT INTO seasons(name,start_date,end_date) VALUES('RESULTS','2092-01-01','2092-12-31') RETURNING id")).rows[0].id;
      const programme=(await c.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'RESULTS','Results','2092-01-01') RETURNING id",[season])).rows[0].id;
      const version=(await c.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1',$1,'[2092-01-01,2093-01-01)') RETURNING id",[programme])).rows[0].id;
      const competition=(await c.query("INSERT INTO competitions(season_id,name) VALUES($1,'Governed Results') RETURNING id",[season])).rows[0].id;
      const stage=(await c.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,'WILAYA') RETURNING id",[competition,programme,version])).rows[0].id;
      const sport=(await c.query("INSERT INTO sports(code,name,sport_type) VALUES('RESULTS','Results Sport','INDIVIDUAL') RETURNING id")).rows[0].id;
      const event=(await c.query("INSERT INTO events(sport_id,code,name,format) VALUES($1,'RESULT','Result Event','INDIVIDUAL') RETURNING id",[sport])).rows[0].id;
      const category=(await c.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'RESULT','Results','FEMALE',$2) RETURNING id",[programme,version])).rows[0].id;
      const occurrence=(await c.query("INSERT INTO calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) VALUES($1,$2,$3,$4,'2092-02-01T09:00:00Z') RETURNING id",[stage,event,category,version])).rows[0].id;
      const entry=(await c.query("INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'INDIVIDUAL',$4) RETURNING id",[stage,category,ins,version])).rows[0].id;
      await c.query("INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",[entry,participant,stage,category]);
      const base=[competition,stage,occurrence,event,category,entry,version];
      const result=(await c.query("INSERT INTO results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT','{\"score\":10}'::jsonb) RETURNING id",base)).rows[0].id;
      const team=(await c.query("INSERT INTO teams(institution_id,category_id,stage_id,name) VALUES($1,$2,$3,'Results Team') RETURNING id",[ins,category,stage])).rows[0].id;
      const teamEntry=(await c.query("INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'TEAM',$4) RETURNING id",[stage,category,ins,version])).rows[0].id;
      await c.query("INSERT INTO team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",[teamEntry,team,stage,category]);
      expect((await c.query("INSERT INTO results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT','{\"score\":9}'::jsonb) RETURNING id",[competition,stage,occurrence,event,category,teamEntry,version])).rows[0].id).toBeTruthy();
      await c.query("UPDATE results SET result_data='{\"score\":11}'::jsonb WHERE id=$1",[result]);
      await fails(c,()=>c.query("UPDATE results SET occurrence_id=$1 WHERE id=$2",[stage,result]),/occurrence must belong/);
      await fails(c,()=>c.query("UPDATE results SET category_id=gen_random_uuid() WHERE id=$1",[result]),/category must match/);
      await fails(c,()=>c.query("UPDATE results SET regulation_version_id=gen_random_uuid() WHERE id=$1",[result]),/regulation version/);
      await c.query("UPDATE results SET governed_status='SUBMITTED' WHERE id=$1",[result]);
      await fails(c,()=>c.query("UPDATE results SET governed_status='VALIDATED' WHERE id=$1",[result]),/validation status/);
      const revision=(await c.query("INSERT INTO result_revisions(result_id,revision_no,prior_snapshot,new_snapshot,reason,actor_user_id) VALUES($1,1,'{\"score\":11}'::jsonb,'{\"score\":12}'::jsonb,'measurement correction',$2) RETURNING id",[result,validator])).rows[0].id;
      expect(revision).toBeTruthy();
      await fails(c,()=>c.query("INSERT INTO result_revisions(result_id,revision_no,prior_snapshot,new_snapshot,reason) VALUES($1,1,'{}','{}','duplicate')",[result]),/sequential|duplicate/);
      await fails(c,()=>c.query("UPDATE result_revisions SET reason='tamper' WHERE id=$1",[revision]),/append-only/);
      await fails(c,()=>c.query("DELETE FROM result_revisions WHERE id=$1",[revision]),/append-only/);
      const validation=(await c.query("INSERT INTO result_validations(result_id,revision_no,decision,validator_user_id,notes) VALUES($1,1,'VALIDATED',$2,'verified') RETURNING id",[result,validator])).rows[0].id;
      expect(validation).toBeTruthy();
      expect((await c.query('SELECT governed_status FROM results WHERE id=$1',[result])).rows[0].governed_status).toBe('VALIDATED');
      await fails(c,()=>c.query("UPDATE results SET result_data='{}'::jsonb WHERE id=$1",[result]),/immutable/);
      await fails(c,()=>c.query("UPDATE results SET stage_id=gen_random_uuid() WHERE id=$1",[result]),/immutable|stage competition/);
      await fails(c,()=>c.query("INSERT INTO result_validations(result_id,revision_no,decision,validator_user_id) VALUES($1,1,'VALIDATED',$2)",[result,validator]),/current official|duplicate/);
      await fails(c,()=>c.query("INSERT INTO result_validations(result_id,revision_no,decision,validator_user_id) VALUES($1,2,'VALIDATED',$2)",[result,validator]),/existing result revision/);
      await fails(c,()=>c.query("INSERT INTO result_validations(result_id,revision_no,decision,validator_user_id) VALUES($1,1,'REJECTED',gen_random_uuid())",[result]),/foreign key|active user/);
      await fails(c,()=>c.query("UPDATE results SET governed_status='DRAFT' WHERE id=$1",[result]),/forward-only/);
      await fails(c,()=>c.query("UPDATE results SET governed_status='ARCHIVED',archived_at='2099-01-01' WHERE id=$1",[result]),/database-controlled/);
      await c.query("UPDATE results SET governed_status='ARCHIVED' WHERE id=$1",[result]);
      expect((await c.query('SELECT archived_at FROM results WHERE id=$1',[result])).rows[0].archived_at).toBeTruthy();
      await fails(c,()=>c.query("UPDATE results SET archived_at='2099-01-01' WHERE id=$1",[result]),/database-controlled|immutable/);
      await fails(c,()=>c.query('DELETE FROM results WHERE id=$1',[result]),/cannot be deleted/);
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });
});
