import { pool } from '../../infrastructure/db.js';
import type { AuthenticatedRequest } from '../../http/auth-guard.js';
import { scopeCondition, stageEligibilityCondition } from '../../http/auth-guard.js';

export type Page = { limit: number; offset: number };
type Listed = { rows: Record<string, unknown>[]; total: number };
async function listed(sql: string, values: unknown[], page: Page): Promise<Listed> {
  const count = await pool.query(`select count(*)::int as total from (${sql}) reference_rows`, values);
  const rows = await pool.query(`${sql} limit $${values.length + 1} offset $${values.length + 2}`, [...values, page.limit, page.offset]);
  return { rows: rows.rows, total: count.rows[0].total };
}
function scopedStages(request: AuthenticatedRequest, alias: string, parameter: number) { return stageEligibilityCondition(request, alias, parameter); }

export const competitionReferences = {
  stages: (request: AuthenticatedRequest, query: { competition_id?: string; status?: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values], where = [scope.sql];
    if (query.competition_id) { values.push(query.competition_id); where.push(`s.competition_id=$${values.length}`); }
    if (query.status) { values.push(query.status); where.push(`s.status=$${values.length}`); }
    return listed(`select s.id, s.stage_level_code as code, s.stage_level_code as label, s.status, s.competition_id, s.programme_id, s.regulation_version_id from competition_stages s where ${where.join(' and ')} order by s.stage_level_code, s.id`, values, query);
  },
  occurrences: (request: AuthenticatedRequest, query: { stage_id?: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values], where = [scope.sql];
    if (query.stage_id) { values.push(query.stage_id); where.push(`o.stage_id=$${values.length}`); }
    return listed(`select o.id, e.code, e.name as label, o.status, o.stage_id, o.event_id, o.category_id, o.regulation_version_id, o.start_at from calendar_occurrences o join competition_stages s on s.id=o.stage_id join events e on e.id=o.event_id where ${where.join(' and ')} order by o.start_at, o.id`, values, query);
  },
  events: (request: AuthenticatedRequest, query: { stage_id: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values, query.stage_id];
    return listed(`select distinct e.id, e.code, e.name as label, e.status, o.stage_id, o.category_id, o.regulation_version_id from calendar_occurrences o join competition_stages s on s.id=o.stage_id join events e on e.id=o.event_id where ${scope.sql} and o.stage_id=$${values.length} order by e.name,e.id`, values, query);
  },
  categories: (request: AuthenticatedRequest, query: { stage_id: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values, query.stage_id];
    return listed(`select distinct c.id,c.code,c.name as label,c.status,o.stage_id,c.gender_code,o.regulation_version_id from calendar_occurrences o join competition_stages s on s.id=o.stage_id join categories c on c.id=o.category_id where ${scope.sql} and o.stage_id=$${values.length} order by c.name,c.id`, values, query);
  },
  regulationVersions: (request: AuthenticatedRequest, query: { stage_id: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values, query.stage_id];
    return listed(`select v.id,v.version_no as code,v.version_no as label,v.status,s.id as stage_id,v.programme_id,v.effective_period::text as effective_period from competition_stages s join regulation_versions v on v.id=s.regulation_version_id where ${scope.sql} and s.id=$${values.length} order by v.version_no,v.id`, values, query);
  },
  dairas: (query: { wilaya_id?: number } & Page) => {
    const values: unknown[] = [], where: string[] = [];
    if (query.wilaya_id) { values.push(query.wilaya_id); where.push(`d.wilaya_id=$${values.length}`); }
    return listed(`select d.id,d.name as label,d.wilaya_id from dairas d${where.length ? ` where ${where.join(' and ')}` : ''} order by d.name,d.id`, values, query);
  },
  organizations: (query: { wilaya_id?: number } & Page) => {
    const values: unknown[] = [], where = ['o.archived_at is null'];
    if (query.wilaya_id) { values.push(query.wilaya_id); where.push(`o.wilaya_id=$${values.length}`); }
    return listed(`select o.id,o.name as label,o.wilaya_id,o.code,o.status from organizations o where ${where.join(' and ')} order by o.name,o.id`, values, query);
  },
  institutions: (request: AuthenticatedRequest, query: { organization_id?: string; daira_id?: number } & Page) => {
    const scope = scopeCondition(request, 'institution', 'i', 1), values: unknown[] = [...scope.values], where = ['i.archived_at is null', scope.sql];
    if (query.organization_id) { values.push(query.organization_id); where.push(`i.organization_id=$${values.length}`); }
    if (query.daira_id) { values.push(query.daira_id); where.push(`i.daira_id=$${values.length}`); }
    return listed(`select i.id,i.name as label,i.organization_id,i.daira_id,i.code,i.status from educational_institutions i where ${where.join(' and ')} order by i.name,i.id`, values, query);
  },
  participants: (request: AuthenticatedRequest, query: { institution_id?: string } & Page) => {
    const scope = scopeCondition(request, 'participant', 'p', 1), values: unknown[] = [...scope.values], where = ['p.archived_at is null', scope.sql];
    if (query.institution_id) { values.push(query.institution_id); where.push(`p.institution_id=$${values.length}`); }
    return listed(`select p.id,coalesce(nullif(concat_ws(' ',p.given_name,p.family_name),''),'Participant') as label,p.institution_id from participants p where ${where.join(' and ')} order by p.given_name nulls last,p.family_name nulls last,p.id`, values, query);
  },
  teams: (request: AuthenticatedRequest, query: { stage_id: string; category_id?: string } & Page) => {
    const scope = scopedStages(request, 's', 1), values: unknown[] = [...scope.values, query.stage_id], where = [`${scope.sql}`, `t.stage_id=$${values.length}`];
    const kind = request.auth.institutionId ? 'institution' : request.auth.dairaId != null ? 'daira' : request.auth.organizationId ? 'organization' : 'national';
    if (kind === 'institution') { values.push(request.auth.institutionId!); where.push(`t.institution_id=$${values.length}`); }
    else if (kind === 'daira') { values.push(String(request.auth.dairaId)); where.push(`exists(select 1 from educational_institutions i where i.id=t.institution_id and i.daira_id=$${values.length})`); }
    else if (kind === 'organization') { values.push(request.auth.organizationId!); where.push(`(t.representing_organization_id=$${values.length} or exists(select 1 from educational_institutions i where i.id=t.institution_id and i.organization_id=$${values.length}))`); }
    if (query.category_id) { values.push(query.category_id); where.push(`t.category_id=$${values.length}`); }
    return listed(`select t.id,t.name as label,t.status,t.institution_id,t.representing_organization_id,t.stage_id,t.category_id from teams t join competition_stages s on s.id=t.stage_id where ${where.join(' and ')} order by t.name,t.id`, values, query);
  }
};
