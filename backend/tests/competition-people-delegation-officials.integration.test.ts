import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
const enabled = Boolean(process.env.DATABASE_URL); const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
async function fails(c: pg.PoolClient, fn: () => Promise<unknown>, rx?: RegExp) { await c.query('SAVEPOINT expected_failure'); try { await fn(); } catch (e) { await c.query('ROLLBACK TO SAVEPOINT expected_failure'); await c.query('RELEASE SAVEPOINT expected_failure'); if (rx) expect(String((e as Error).message)).toMatch(rx); return; } await c.query('ROLLBACK TO SAVEPOINT expected_failure'); await c.query('RELEASE SAVEPOINT expected_failure'); throw new Error('Expected failure'); }
suite('competition people delegation officials foundation', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); }); afterAll(async () => { await pool?.end(); });
  it('creates only the ARCH-010 foundation tables', async () => { const r = await pool!.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])", [['people','delegations','delegation_members','competition_officials','official_assignments']]); expect(r.rows.map(x=>x.table_name).sort()).toEqual(['competition_officials','delegation_members','delegations','official_assignments','people']); });
  it('enforces people, delegations, and official assignment context/history', async () => {
    const c=await pool!.connect(); try { await c.query('BEGIN');
      const org=(await c.query("INSERT INTO organizations(name,code) VALUES('People Org','PEOPLE-ORG') RETURNING id")).rows[0].id;
      const ins=(await c.query("INSERT INTO educational_institutions(organization_id,name,code) VALUES($1,'People Institution','PEOPLE-INS') RETURNING id",[org])).rows[0].id;
      const user=(await c.query("INSERT INTO users(username,display_name) VALUES('people.user','Person User') RETURNING id")).rows[0].id;
      const participant=(await c.query("INSERT INTO participants(institution_id,given_name,family_name) VALUES($1,'Athlete','Person') RETURNING id",[ins])).rows[0].id;
      const independent=(await c.query("INSERT INTO people(given_name,family_name) VALUES('Independent','Coach') RETURNING id")).rows[0].id;
      await c.query("INSERT INTO people(user_id,given_name,family_name) VALUES($1,'User','Linked')",[user]); await c.query("INSERT INTO people(participant_id,given_name,family_name) VALUES($1,'Participant','Linked')",[participant]);
      await fails(c,()=>c.query("INSERT INTO people(user_id,given_name,family_name) VALUES($1,'Duplicate','User')",[user]));
      const season=(await c.query("INSERT INTO seasons(name,start_date,end_date) VALUES('PEOPLE','2091-01-01','2091-12-31') RETURNING id")).rows[0].id;
      const programme=(await c.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'PEOPLE','People','2091-01-01') RETURNING id",[season])).rows[0].id;
      const version=(await c.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1',$1,'[2091-01-01,2092-01-01)') RETURNING id",[programme])).rows[0].id;
      const competition=(await c.query("INSERT INTO competitions(season_id,name) VALUES($1,'People') RETURNING id",[season])).rows[0].id;
      const stage=(await c.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,'WILAYA') RETURNING id",[competition,programme,version])).rows[0].id;
      const delegation=(await c.query("INSERT INTO delegations(stage_id,institution_id,name) VALUES($1,$2,'Delegation') RETURNING id",[stage,ins])).rows[0].id;
      await fails(c,()=>c.query("INSERT INTO delegations(stage_id,institution_id,representing_organization_id,name) VALUES($1,$2,$3,'Bad')",[stage,ins,org]));
      const member=(await c.query("INSERT INTO delegation_members(delegation_id,person_id,role) VALUES($1,$2,'COACH') RETURNING id",[delegation,independent])).rows[0].id;
      await fails(c,()=>c.query("INSERT INTO delegation_members(delegation_id,person_id,role) VALUES($1,$2,'COACH')",[delegation,independent]));
      const official=(await c.query("INSERT INTO competition_officials(person_id,official_type) VALUES($1,'REFEREE') RETURNING id",[independent])).rows[0].id;
      const assignment=(await c.query("INSERT INTO official_assignments(official_id,stage_id,role,status) VALUES($1,$2,'REFEREE','ASSIGNED') RETURNING id",[official,stage])).rows[0].id;
      await fails(c,()=>c.query("INSERT INTO official_assignments(official_id,stage_id,role,status) VALUES($1,$2,'REFEREE','ASSIGNED')",[official,stage]));
      const sport=(await c.query("INSERT INTO sports(code,name,sport_type) VALUES('PEOPLE','People Sport','INDIVIDUAL') RETURNING id")).rows[0].id;
      const event=(await c.query("INSERT INTO events(sport_id,code,name,format) VALUES($1,'EVENT','Event','INDIVIDUAL') RETURNING id",[sport])).rows[0].id;
      const occurrence=(await c.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,start_at) VALUES($1,$2,$3,'2091-02-01T09:00:00Z') RETURNING id",[stage,event,version])).rows[0].id;
      await c.query("INSERT INTO official_assignments(official_id,stage_id,occurrence_id,role,status) VALUES($1,$2,$3,'JUDGE','ASSIGNED')",[official,stage,occurrence]);
      const otherStage=(await c.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,'DAIRA') RETURNING id",[competition,programme,version])).rows[0].id;
      await fails(c,()=>c.query("INSERT INTO official_assignments(official_id,stage_id,occurrence_id,role) VALUES($1,$2,$3,'JUDGE')",[official,otherStage,occurrence]),/occurrence must belong/);
      await c.query("UPDATE competition_stages SET status='SCHEDULED' WHERE id=$1",[stage]); await c.query("UPDATE competition_stages SET status='ACTIVE' WHERE id=$1",[stage]);
      await fails(c,()=>c.query("UPDATE delegation_members SET role='HEAD_OF_DELEGATION' WHERE id=$1",[member]),/immutable/); await fails(c,()=>c.query('DELETE FROM delegation_members WHERE id=$1',[member]));
      await fails(c,()=>c.query("UPDATE official_assignments SET role='JUDGE' WHERE id=$1",[assignment]),/immutable/); await fails(c,()=>c.query('DELETE FROM official_assignments WHERE id=$1',[assignment]));
      await c.query('ROLLBACK');
    } finally { c.release(); }
  });
});
