import { pool } from '../../infrastructure/db.js';

export type Page = { limit: number; offset: number };
export type Scope = { sql: string; values: string[] };
export type Filters = Record<string, string | undefined>;

async function list(select: string, from: string, scope: Scope, filters: Filters, fields: Record<string, string>, page: Page, order: string) {
  const values: unknown[] = [...scope.values];
  const where = [scope.sql];
  for (const [filter, column] of Object.entries(fields)) {
    const filterValue = filters[filter];
    if (filterValue) { values.push(filterValue); where.push(`${column}=$${values.length}`); }
  }
  const predicate = where.join(' AND ');
  const count = await pool.query(`select count(*)::int as total from ${from} where ${predicate}`, values);
  values.push(page.limit, page.offset);
  const rows = await pool.query(`select ${select} from ${from} where ${predicate} order by ${order} limit $${values.length - 1} offset $${values.length}`, values);
  return { rows: rows.rows, total: count.rows[0].total as number };
}

export const competitionCollections = {
  entries: (scope: Scope, filters: Filters, page: Page) => list('e.*', 'competition_entries e join educational_institutions i on i.id=e.institution_id', scope, filters, { stage_id: 'e.stage_id', category_id: 'e.category_id', status: 'e.status', institution_id: 'e.institution_id', regulation_version_id: 'e.regulation_version_id' }, page, 'e.created_at desc, e.id desc'),
  results: (scope: Scope, filters: Filters, page: Page) => list(`r.*, v.id as validation_id, v.decision, v.revision_no, v.validator_user_id, v.created_at as validation_created_at, case when v.revision_no=0 then r.result_data else revision.new_snapshot end as official_payload, coalesce((select max(result_revisions.revision_no) from result_revisions where result_revisions.result_id=r.id),0) as latest_revision_no`, `results r join competition_entries e on e.id=r.competition_entry_id join educational_institutions i on i.id=e.institution_id left join lateral (select current_validation.* from result_validations current_validation where current_validation.result_id=r.id and not exists(select 1 from result_validations superseding where superseding.supersedes_validation_id=current_validation.id) order by current_validation.created_at desc,current_validation.id desc limit 1) v on true left join result_revisions revision on revision.result_id=r.id and revision.revision_no=v.revision_no`, scope, filters, { stage_id: 'r.stage_id', occurrence_id: 'r.occurrence_id', event_id: 'r.event_id', category_id: 'r.category_id', competition_entry_id: 'r.competition_entry_id', regulation_version_id: 'r.regulation_version_id', status: 'r.governed_status' }, page, 'r.created_at desc, r.id desc'),
  qualifications: (scope: Scope, filters: Filters, page: Page) => list('q.*', 'qualifications q join competition_entries e on e.id=q.source_entry_id join educational_institutions i on i.id=e.institution_id', scope, filters, { source_entry_id: 'q.source_entry_id', source_stage_id: 'q.source_stage_id', destination_stage_id: 'q.destination_stage_id', status: 'q.status', regulation_version_id: 'q.regulation_version_id' }, page, 'q.created_at desc, q.id desc'),
  rankings: (scope: Scope, filters: Filters, page: Page) => list('r.*', 'rankings r', { sql: `exists (select 1 from competition_entries e join educational_institutions i on i.id=e.institution_id where e.stage_id=r.stage_id and ${scope.sql})`, values: scope.values }, filters, { stage_id: 'r.stage_id', event_id: 'r.event_id', category_id: 'r.category_id', status: 'r.status', regulation_version_id: 'r.regulation_version_id', ranking_type: 'r.ranking_type' }, page, 'r.created_at desc, r.id desc'),
  awards: (scope: Scope, filters: Filters, page: Page) => list('a.*', 'awards a join competition_entries e on e.id=a.competition_entry_id join educational_institutions i on i.id=e.institution_id', scope, filters, { ranking_id: 'a.ranking_id', competition_entry_id: 'a.competition_entry_id', status: 'a.status', regulation_version_id: 'a.regulation_version_id' }, page, 'a.created_at desc, a.id desc')
};
