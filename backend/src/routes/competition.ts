import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePolicy, canAccessCompetitionResource, canAccessResource, competitionResourceExists, scopeCondition, type AuthenticatedRequest } from '../http/auth-guard.js';
import { awardDto, entryDto, pageMeta, qualificationDto, rankingDto, rankingRowDto, resultDto, resultRevisionDto, resultValidationDto } from '../http/competition-contracts.js';
import { CompetitionError } from '../services/competition/errors.js';
import { competitionCollections } from '../services/competition/collections.js';
import { entries } from '../services/competition/entries.js';
import { results } from '../services/competition/results.js';
import { qualifications } from '../services/competition/qualifications.js';
import { validateQualificationCreate, validateQualificationEvidence } from '../services/competition/qualification-authorization.js';
import { validateRankingCreate, validateRankingInput, validateRankingRow, validateAwardCreate } from '../services/competition/ranking-award-authorization.js';
import { rankings } from '../services/competition/rankings.js';
import { awards } from '../services/competition/awards.js';

const id = z.string().uuid();
const page = z.object({ limit: z.coerce.number().int().positive().max(100).default(25), offset: z.coerce.number().int().nonnegative().default(0) });
const entryList = page.extend({ stage_id: id.optional(), category_id: id.optional(), status: z.enum(['DRAFT', 'SUBMITTED', 'VALIDATED', 'WITHDRAWN', 'REJECTED', 'ARCHIVED']).optional(), institution_id: id.optional(), regulation_version_id: id.optional() });
const qualificationList = page.extend({ source_entry_id: id.optional(), source_stage_id: id.optional(), destination_stage_id: id.optional(), status: z.enum(['DRAFT', 'APPROVED', 'REJECTED', 'REVOKED', 'ARCHIVED']).optional(), regulation_version_id: id.optional() });
const rankingList = page.extend({ stage_id: id.optional(), event_id: id.optional(), category_id: id.optional(), status: z.enum(['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED']).optional(), regulation_version_id: id.optional(), ranking_type: z.enum(['EVENT', 'CATEGORY', 'STAGE']).optional() });
const awardList = page.extend({ ranking_id: id.optional(), competition_entry_id: id.optional(), status: z.enum(['DRAFT', 'ISSUED', 'REVOKED', 'ARCHIVED']).optional(), regulation_version_id: id.optional() });
const actor = (request: AuthenticatedRequest) => ({ userId: request.auth.userId });

function send(reply: any, error: unknown) {
  if (error instanceof z.ZodError) return reply.code(422).send({ error: 'validation_error' });
  if (error instanceof CompetitionError) return reply.code(error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' || error.code === 'INVALID_STATE' ? 409 : 422).send({ error: error.code.toLowerCase() });
  throw error;
}

async function requireRelated(request: AuthenticatedRequest, resource: any, resourceId?: string) {
  if (!resourceId) return;
  const allowed = resource === 'institution' || resource === 'participant' ? await canAccessResource(request, resource, resourceId) : await canAccessCompetitionResource(request, resource, resourceId);
  if (!allowed) throw new CompetitionError('FORBIDDEN', 'Referenced resource is outside the administrative scope');
}

async function guarded(request: AuthenticatedRequest, reply: any) {
  if (!await requirePolicy(request, reply, { permission: 'competition.view', resource: 'institution' })) return false;
  const path = request.url.split('?')[0];
  const resource = path.includes('competition-entries') ? 'competition_entry' : path.includes('competition-results') ? 'competition_result' : path.includes('qualifications') ? 'qualification' : path.includes('rankings') ? 'ranking' : path.includes('awards') ? 'award' : undefined;
  const resourceId = (request.params as { id?: string } | undefined)?.id;
  if (resource && resourceId && !await canAccessCompetitionResource(request, resource, resourceId)) {
    const exists = await competitionResourceExists(resource, resourceId);
    void reply.code(exists ? 403 : 404).send({ error: exists ? 'forbidden' : 'not_found' });
    return false;
  }
  return true;
}

export async function registerCompetitionRoutes(app: FastifyInstance) {
  const command = (handler: (request: AuthenticatedRequest & { params: any; body: any; query: any }, reply: any) => Promise<unknown>) => async (request: any, reply: any) => {
    if (!await guarded(request, reply)) return;
    try { return await handler(request, reply); } catch (error) { return send(reply, error); }
  };
  const collection = (schema: z.ZodTypeAny, fetch: (scope: ReturnType<typeof scopeCondition>, query: any) => Promise<{ rows: Record<string, unknown>[]; total: number }>, dto: (row: Record<string, unknown>) => unknown) => command(async request => {
    const query = schema.parse(request.query);
    const result = await fetch(scopeCondition(request, 'institution', 'i', 1), query);
    return { data: result.rows.map(row => dto(row)), meta: pageMeta(query.limit, query.offset, result.total) };
  });

  app.post('/api/v1/admin/competition-entries', command(async request => {
    const body = z.object({ stageId: id, categoryId: id, institutionId: id.optional(), representingOrganizationId: id.optional(), regulationVersionId: id, participantId: id.optional(), teamId: id.optional() }).refine(value => Boolean(value.participantId) !== Boolean(value.teamId)).parse(request.body);
    await requireRelated(request, 'institution', body.institutionId);
    if (body.participantId) await requireRelated(request, 'participant', body.participantId);
    if (body.teamId) await requireRelated(request, 'competition_team', body.teamId);
    const created = body.participantId ? await entries.createIndividual(actor(request), { ...body, participantId: body.participantId }) : await entries.createTeam(actor(request), { ...body, teamId: body.teamId! });
    return { data: entryDto(created) };
  }));
  app.get('/api/v1/admin/competition-entries', collection(entryList, (scope, query) => competitionCollections.entries(scope, query, query), entryDto));
  app.get('/api/v1/admin/competition-entries/:id', command(async request => ({ data: entryDto(await entries.read(id.parse(request.params.id))) })));
  for (const [name, status] of [['submit', 'SUBMITTED'], ['validate', 'VALIDATED'], ['reject', 'REJECTED'], ['withdraw', 'WITHDRAWN'], ['archive', 'ARCHIVED']] as const) app.post(`/api/v1/admin/competition-entries/:id/${name}`, command(async request => ({ data: entryDto(await entries.transition(actor(request), id.parse(request.params.id), status)) })));

  app.post('/api/v1/admin/competition-results', command(async request => {
    const body = z.object({ competitionId: id, stageId: id, occurrenceId: id.optional(), eventId: id, categoryId: id, competitionEntryId: id, regulationVersionId: id, resultData: z.record(z.unknown()) }).parse(request.body);
    await requireRelated(request, 'competition_entry', body.competitionEntryId);
    return { data: resultDto(await results.create(actor(request), body)) };
  }));
  app.get('/api/v1/admin/competition-results/:id', command(async request => ({ data: resultDto(await results.official(id.parse(request.params.id))) })));
  app.get('/api/v1/admin/competition-results/:id/history', command(async request => { const query = page.parse(request.query); const history = await results.history(id.parse(request.params.id), query); return { data: { result: resultDto(history.result), revisions: history.revisions.map(resultRevisionDto), validations: history.validations.map(resultValidationDto) }, meta: pageMeta(query.limit, query.offset, history.total) }; }));
  app.post('/api/v1/admin/competition-results/:id/submit', command(async request => ({ data: resultDto(await results.submit(actor(request), id.parse(request.params.id))) })));
  app.post('/api/v1/admin/competition-results/:id/revisions', command(async request => ({ data: resultRevisionDto(await results.revision(actor(request), id.parse(request.params.id), z.object({ revisionNo: z.number().int().positive(), priorSnapshot: z.record(z.unknown()), newSnapshot: z.record(z.unknown()), reason: z.string().min(1) }).parse(request.body))) })));
  for (const decision of ['VALIDATED', 'REJECTED', 'VOID'] as const) app.post(`/api/v1/admin/competition-results/:id/${decision.toLowerCase()}`, command(async request => ({ data: resultValidationDto(await results.decision(actor(request), id.parse(request.params.id), { ...z.object({ revisionNo: z.number().int().nonnegative(), supersedesValidationId: id.optional(), notes: z.string().optional() }).parse(request.body), decision })) })));
  app.post('/api/v1/admin/competition-results/:id/archive', command(async request => ({ data: resultDto(await results.archive(actor(request), id.parse(request.params.id))) })));

  app.post('/api/v1/admin/qualifications', command(async request => {
    const body = z.object({ sourceEntryId: id, sourceStageId: id, destinationStageId: id, destinationEntryId: id.optional(), regulationVersionId: id, decisionType: z.enum(['RESULT_BASED', 'MANUAL']), reason: z.string().optional(), regulationSourceId: id.optional() }).parse(request.body);
    await requireRelated(request, 'competition_entry', body.sourceEntryId); if (body.destinationEntryId) await requireRelated(request, 'competition_entry', body.destinationEntryId); await validateQualificationCreate(body);
    return { data: qualificationDto(await qualifications.create(actor(request), body)) };
  }));
  app.get('/api/v1/admin/qualifications', collection(qualificationList, (scope, query) => competitionCollections.qualifications(scope, query, query), qualificationDto));
  app.get('/api/v1/admin/qualifications/:id', command(async request => { const history = await qualifications.history(id.parse(request.params.id)); return { data: { qualification: qualificationDto(history.qualification), evidence: history.evidence.map((row: Record<string, unknown>) => ({ id: row.id, result_id: row.result_id, result_validation_id: row.result_validation_id, created_at: row.created_at == null ? null : new Date(row.created_at as string).toISOString() })) } }; }));
  app.post('/api/v1/admin/qualifications/:id/evidence', command(async request => { const body = z.object({ resultId: id, resultValidationId: id }).parse(request.body), qualificationId = id.parse(request.params.id); await requireRelated(request, 'competition_result', body.resultId); await validateQualificationEvidence(qualificationId, body.resultId, body.resultValidationId); return { data: await qualifications.evidence(actor(request), qualificationId, body.resultId, body.resultValidationId) }; }));
  for (const status of ['APPROVED', 'REJECTED', 'REVOKED', 'ARCHIVED'] as const) app.post(`/api/v1/admin/qualifications/:id/${status === 'APPROVED' ? 'approve' : status.toLowerCase()}`, command(async request => ({ data: qualificationDto(await qualifications.transition(actor(request), id.parse(request.params.id), status)) })));

  app.post('/api/v1/admin/rankings', command(async request => {
    const body = z.object({ stageId: id, occurrenceId: id.optional(), eventId: id, categoryId: id, regulationVersionId: id, rankingType: z.enum(['EVENT', 'CATEGORY', 'STAGE']), calculationVersion: z.string().min(1), calculationMetadata: z.record(z.unknown()).optional(), supersedesRankingId: id.optional() }).parse(request.body);
    await requireRelated(request, 'competition_stage', body.stageId); if (body.supersedesRankingId) await requireRelated(request, 'ranking', body.supersedesRankingId); await validateRankingCreate(body);
    return { data: rankingDto(await rankings.create(actor(request), body)) };
  }));
  app.get('/api/v1/admin/rankings', collection(rankingList, (scope, query) => competitionCollections.rankings(scope, query, query), rankingDto));
  app.get('/api/v1/admin/rankings/current', command(async request => { const query = z.object({ stageId: id, eventId: id, categoryId: id, rankingType: z.enum(['EVENT', 'CATEGORY', 'STAGE']) }).parse(request.query); const current = await rankings.current(query.stageId, query.eventId, query.categoryId, query.rankingType); return { data: current ? rankingDto(current, undefined, true) : null }; }));
  app.get('/api/v1/admin/rankings/:id', command(async request => { const ranking = await rankings.read(id.parse(request.params.id)); return { data: rankingDto(ranking.ranking, ranking.rows) }; }));
  for (const [name, status] of [['validate', 'VALIDATED'], ['publish', 'PUBLISHED'], ['archive', 'ARCHIVED']] as const) app.post(`/api/v1/admin/rankings/:id/${name}`, command(async request => ({ data: rankingDto(await rankings.transition(actor(request), id.parse(request.params.id), status)) })));
  app.post('/api/v1/admin/rankings/:id/inputs', command(async request => { const body = z.object({ resultId: id, resultValidationId: id }).parse(request.body), rankingId = id.parse(request.params.id); await requireRelated(request, 'competition_result', body.resultId); await validateRankingInput(rankingId, body.resultId, body.resultValidationId); return { data: await rankings.input(actor(request), rankingId, body.resultId, body.resultValidationId) }; }));
  app.delete('/api/v1/admin/rankings/:id/inputs/:inputId', command(async request => { await rankings.removeInput(actor(request), id.parse(request.params.id), id.parse(request.params.inputId)); return { data: { id: request.params.inputId } }; }));
  app.post('/api/v1/admin/rankings/:id/rows', command(async request => { const body = z.object({ competitionEntryId: id, position: z.number().int().positive(), points: z.number().optional() }).parse(request.body), rankingId = id.parse(request.params.id); await requireRelated(request, 'competition_entry', body.competitionEntryId); await validateRankingRow(rankingId, body.competitionEntryId); return { data: rankingRowDto(await rankings.row(actor(request), rankingId, body.competitionEntryId, body.position, body.points)) }; }));
  app.delete('/api/v1/admin/rankings/:id/rows/:rowId', command(async request => { await rankings.removeRow(actor(request), id.parse(request.params.id), id.parse(request.params.rowId)); return { data: { id: request.params.rowId } }; }));

  app.post('/api/v1/admin/awards', command(async request => { const body = z.object({ rankingId: id.optional(), competitionEntryId: id, awardType: z.enum(['MEDAL', 'TITLE', 'TROPHY', 'CERTIFICATE', 'OTHER']), label: z.string().optional(), regulationVersionId: id }).parse(request.body); if (body.rankingId) await requireRelated(request, 'ranking', body.rankingId); await requireRelated(request, 'competition_entry', body.competitionEntryId); await validateAwardCreate(body); return { data: awardDto(await awards.create(actor(request), body)) }; }));
  app.get('/api/v1/admin/awards', collection(awardList, (scope, query) => competitionCollections.awards(scope, query, query), awardDto));
  app.get('/api/v1/admin/awards/:id', command(async request => ({ data: awardDto(await awards.read(id.parse(request.params.id))) })));
  for (const [name, operation] of [['issue', 'issue'], ['revoke', 'revoke'], ['archive', 'archive']] as const) app.post(`/api/v1/admin/awards/:id/${name}`, command(async request => ({ data: awardDto(await awards[operation](actor(request), id.parse(request.params.id))) })));
}
