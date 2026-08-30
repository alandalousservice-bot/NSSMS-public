import { transaction, audit, one } from './shared.js';
import type { Actor } from './types.js';

export type EligibilityInput = { scopeType: 'ORGANIZATION'|'DAIRA'|'INSTITUTION'; organizationId?: string; dairaId?: number; institutionId?: string };

const columns = (input: EligibilityInput) => input.scopeType === 'ORGANIZATION' ? [input.organizationId!, null, null] : input.scopeType === 'DAIRA' ? [null, input.dairaId!, null] : [null, null, input.institutionId!];

export const stageEligibility = {
  list: (stageId: string) => transaction(async c => (await c.query("select id,stage_id,scope_type,organization_id,daira_id,institution_id,created_by_user_id,created_at from competition_stage_scope_eligibility where stage_id=$1 order by scope_type,id", [stageId])).rows),
  add: (actor: Actor, stageId: string, input: EligibilityInput) => transaction(async c => {
    await one(c, 'select id from competition_stages where id=$1', [stageId]);
    const [organizationId, dairaId, institutionId] = columns(input);
    const row = (await c.query('insert into competition_stage_scope_eligibility(stage_id,scope_type,organization_id,daira_id,institution_id,created_by_user_id) values($1,$2,$3,$4,$5,$6) returning *', [stageId, input.scopeType, organizationId, dairaId, institutionId, actor.userId])).rows[0];
    await audit(c, actor.userId, 'ADD_ELIGIBILITY', 'COMPETITION_STAGE', stageId, { eligibilityId: row.id, scopeType: input.scopeType, targetId: organizationId ?? dairaId ?? institutionId });
    return row;
  }),
  remove: (actor: Actor, stageId: string, eligibilityId: string) => transaction(async c => {
    const row = await one(c, 'delete from competition_stage_scope_eligibility where id=$1 and stage_id=$2 returning *', [eligibilityId, stageId]);
    await audit(c, actor.userId, 'REMOVE_ELIGIBILITY', 'COMPETITION_STAGE', stageId, { eligibilityId, scopeType: row.scope_type, targetId: row.organization_id ?? row.daira_id ?? row.institution_id });
    return row;
  })
};
