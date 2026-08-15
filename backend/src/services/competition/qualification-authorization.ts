import { pool } from '../../infrastructure/db.js';
import { CompetitionError } from './errors.js';

export async function validateQualificationCreate(input: Record<string, unknown>) {
  const source = (await pool.query(`select entry.stage_id,entry.category_id,entry.entry_type,entry.regulation_version_id,stage.competition_id,case when entry.entry_type='INDIVIDUAL' then individual.participant_id else team.team_id end as subject_id from competition_entries entry join competition_stages stage on stage.id=entry.stage_id left join individual_entries individual on individual.competition_entry_id=entry.id left join team_entries team on team.competition_entry_id=entry.id where entry.id=$1`, [input.sourceEntryId])).rows[0];
  const destinationStage = (await pool.query('select competition_id,regulation_version_id from competition_stages where id=$1', [input.destinationStageId])).rows[0];
  if (!source || !destinationStage || source.stage_id !== input.sourceStageId || source.competition_id !== destinationStage.competition_id || source.regulation_version_id !== input.regulationVersionId || destinationStage.regulation_version_id !== input.regulationVersionId) throw new CompetitionError('INVALID_CONTEXT', 'Qualification source and destination context is incompatible');
  const progression = (await pool.query('with recursive ancestors(id) as (select parent_stage_id from competition_stages where id=$1 union all select stage.parent_stage_id from competition_stages stage join ancestors on stage.id=ancestors.id where ancestors.id is not null) select exists(select 1 from ancestors where id=$2) as allowed', [input.destinationStageId, input.sourceStageId])).rows[0];
  if (!progression.allowed) throw new CompetitionError('INVALID_CONTEXT', 'Qualification destination stage is not a configured progression');
  if (input.destinationEntryId) {
    const destination = (await pool.query(`select entry.stage_id,entry.category_id,entry.entry_type,entry.regulation_version_id,case when entry.entry_type='INDIVIDUAL' then individual.participant_id else team.team_id end as subject_id from competition_entries entry left join individual_entries individual on individual.competition_entry_id=entry.id left join team_entries team on team.competition_entry_id=entry.id where entry.id=$1`, [input.destinationEntryId])).rows[0];
    if (!destination || destination.stage_id !== input.destinationStageId || destination.category_id !== source.category_id || destination.entry_type !== source.entry_type || destination.regulation_version_id !== input.regulationVersionId || destination.subject_id !== source.subject_id) throw new CompetitionError('INVALID_CONTEXT', 'Qualification destination entry is incompatible with the source');
  }
}

export async function validateQualificationEvidence(qualificationId: string, resultId: string, validationId: string) {
  const context = (await pool.query('select qualification.source_entry_id,qualification.source_stage_id,qualification.regulation_version_id,result.competition_entry_id,result.stage_id,result.regulation_version_id as result_version_id,validation.result_id as validation_result_id from qualifications qualification join results result on result.id=$2 left join result_validations validation on validation.id=$3 where qualification.id=$1', [qualificationId, resultId, validationId])).rows[0];
  if (!context || context.validation_result_id !== resultId || context.competition_entry_id !== context.source_entry_id || context.stage_id !== context.source_stage_id || context.result_version_id !== context.regulation_version_id) throw new CompetitionError('INVALID_CONTEXT', 'Qualification evidence does not match its governed source');
}
