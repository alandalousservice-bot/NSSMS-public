import { pool } from '../../infrastructure/db.js';
import { CompetitionError } from './errors.js';

const invalid = (message: string) => { throw new CompetitionError('INVALID_CONTEXT', message); };

export async function validateRankingCreate(input: Record<string, unknown>) {
  const context = (await pool.query('select stage.regulation_version_id as stage_version_id,occurrence.stage_id as occurrence_stage_id,occurrence.event_id as occurrence_event_id,occurrence.category_id as occurrence_category_id,occurrence.regulation_version_id as occurrence_version_id from competition_stages stage left join calendar_occurrences occurrence on occurrence.id=$2 where stage.id=$1', [input.stageId, input.occurrenceId ?? null])).rows[0];
  if (!context || context.stage_version_id !== input.regulationVersionId || context.occurrence_stage_id !== input.stageId || context.occurrence_event_id !== input.eventId || context.occurrence_category_id !== input.categoryId || context.occurrence_version_id !== input.regulationVersionId) invalid('Ranking context does not match the authoritative stage');
  if (input.supersedesRankingId) {
    const parent = (await pool.query('select stage_id,occurrence_id,event_id,category_id,regulation_version_id,ranking_type from rankings where id=$1', [input.supersedesRankingId])).rows[0];
    if (!parent || parent.stage_id !== input.stageId || parent.occurrence_id !== input.occurrenceId || parent.event_id !== input.eventId || parent.category_id !== input.categoryId || parent.regulation_version_id !== input.regulationVersionId || parent.ranking_type !== input.rankingType) invalid('Ranking supersession context is incompatible');
  }
}

export async function validateRankingInput(rankingId: string, resultId: string, validationId: string) {
  const context = (await pool.query('select ranking.stage_id,ranking.event_id,ranking.category_id,ranking.regulation_version_id,result.stage_id as result_stage_id,result.event_id as result_event_id,result.category_id as result_category_id,result.regulation_version_id as result_version_id,validation.result_id as validation_result_id from rankings ranking join results result on result.id=$2 left join result_validations validation on validation.id=$3 where ranking.id=$1', [rankingId, resultId, validationId])).rows[0];
  if (!context || context.validation_result_id !== resultId || context.stage_id !== context.result_stage_id || context.event_id !== context.result_event_id || context.category_id !== context.result_category_id || context.regulation_version_id !== context.result_version_id) invalid('Ranking input does not match the governed ranking');
}

export async function validateRankingRow(rankingId: string, entryId: string) {
  const context = (await pool.query('select ranking.stage_id,ranking.category_id,entry.stage_id as entry_stage_id,entry.category_id as entry_category_id from rankings ranking join competition_entries entry on entry.id=$2 where ranking.id=$1', [rankingId, entryId])).rows[0];
  if (!context || context.stage_id !== context.entry_stage_id || context.category_id !== context.entry_category_id) invalid('Ranking row entry does not match the governed ranking');
}

export async function validateAwardCreate(input: { rankingId?: string; competitionEntryId: string; regulationVersionId: string }) {
  if (!input.rankingId) return;
  const context = (await pool.query('select ranking.regulation_version_id,row.competition_entry_id from rankings ranking left join ranking_rows row on row.ranking_id=ranking.id and row.competition_entry_id=$2 where ranking.id=$1', [input.rankingId, input.competitionEntryId])).rows[0];
  if (!context || context.regulation_version_id !== input.regulationVersionId || context.competition_entry_id !== input.competitionEntryId) invalid('Award recipient does not match the governed ranking');
}
