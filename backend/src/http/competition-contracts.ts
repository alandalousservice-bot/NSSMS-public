type Row = Record<string, unknown>;

const timestamp = (value: unknown) => value == null ? null : new Date(value as string | Date).toISOString();
const value = (row: Row, key: string) => row[key] ?? null;

export function entryDto(row: Row) {
  return { id: row.id, stage_id: row.stage_id, category_id: row.category_id, institution_id: value(row, 'institution_id'), representing_organization_id: value(row, 'representing_organization_id'), entry_type: row.entry_type, status: row.status, regulation_version_id: row.regulation_version_id, created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: timestamp(row.archived_at) };
}

export function resultDto(row: Row) {
  const decision = row.validation_id == null ? null : { id: row.validation_id, decision: row.decision, revision_no: row.revision_no, decided_by_user_id: row.validator_user_id ?? null, decided_at: timestamp(row.validation_created_at ?? row.validation_created_at) };
  return { id: row.id, competition_id: row.competition_id, stage_id: row.stage_id, occurrence_id: value(row, 'occurrence_id'), event_id: row.event_id, category_id: row.category_id, competition_entry_id: row.competition_entry_id, regulation_version_id: row.regulation_version_id, governed_status: row.governed_status, base_payload: row.result_data, current_authoritative_decision: decision, official_payload: row.official_payload ?? null, legacy_unresolved: row.governed_status === 'LEGACY_UNRESOLVED', created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: timestamp(row.archived_at) };
}

export function resultRevisionDto(row: Row) { return { id: row.id, result_id: row.result_id, revision_no: row.revision_no, prior_payload: row.prior_snapshot, new_payload: row.new_snapshot, reason: row.reason, actor_user_id: row.actor_user_id, created_at: timestamp(row.created_at) }; }
export function resultValidationDto(row: Row) { return { id: row.id, result_id: row.result_id, revision_no: row.revision_no, decision: row.decision, validator_user_id: row.validator_user_id, supersedes_validation_id: value(row, 'supersedes_validation_id'), notes: value(row, 'notes'), created_at: timestamp(row.created_at) }; }

export function qualificationDto(row: Row) { return { id: row.id, source_entry_id: row.source_entry_id, source_stage_id: row.source_stage_id, destination_stage_id: row.destination_stage_id, destination_entry_id: value(row, 'destination_entry_id'), regulation_version_id: row.regulation_version_id, regulation_source_id: value(row, 'regulation_source_id'), decision_type: row.decision_type, status: row.status, reason: value(row, 'reason'), decided_by_user_id: row.decided_by_user_id, decided_at: timestamp(row.decided_at), created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: timestamp(row.archived_at) }; }

export function rankingRowDto(row: Row) { return { id: row.id, competition_entry_id: row.competition_entry_id, position: row.position, points: value(row, 'points'), result_summary: value(row, 'result_summary'), created_at: timestamp(row.created_at) }; }
export function rankingDto(row: Row, rows?: Row[], current = false) { return { id: row.id, stage_id: row.stage_id, occurrence_id: value(row, 'occurrence_id'), event_id: row.event_id, category_id: row.category_id, regulation_version_id: row.regulation_version_id, ranking_type: row.ranking_type, calculation_version: row.calculation_version, status: row.status, supersedes_ranking_id: value(row, 'supersedes_ranking_id'), current, rows: rows?.map(rankingRowDto), created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: timestamp(row.archived_at) }; }

export function awardDto(row: Row) { return { id: row.id, ranking_id: value(row, 'ranking_id'), competition_entry_id: row.competition_entry_id, award_type: row.award_type, label: value(row, 'label'), regulation_version_id: row.regulation_version_id, status: row.status, issued_by_user_id: value(row, 'issued_by_user_id'), issued_at: timestamp(row.issued_at), revoked_by_user_id: value(row, 'revoked_by_user_id'), revoked_at: timestamp(row.revoked_at), created_at: timestamp(row.created_at), updated_at: timestamp(row.updated_at), archived_at: timestamp(row.archived_at) }; }

export const pageMeta = (limit: number, offset: number, total: number) => ({ pagination: { limit, offset, total } });
