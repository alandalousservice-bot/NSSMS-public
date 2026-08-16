const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type Pagination = { limit: number; offset: number; total: number };
export type Envelope<T> = { data: T; meta?: { pagination?: Pagination } };
export type ApiErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'INVALID_CONTEXT' | 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
export class CompetitionApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public requestId?: string, public status?: number) { super(message); }
}

export type Reference = { id: string; label: string; code?: string | null; status?: string | null; competition_id?: string; stage_id?: string; event_id?: string; category_id?: string; regulation_version_id?: string; organization_id?: string; daira_id?: number | null; institution_id?: string; wilaya_id?: number | null };
export type DairaReference = { id: number; label: string; wilaya_id: number };
export type Result = { id: string; competition_id: string | null; stage_id: string | null; occurrence_id: string | null; event_id: string | null; category_id: string | null; competition_entry_id: string | null; regulation_version_id: string | null; governed_status: string; base_payload: unknown; official_payload: unknown | null; current_validation: { id: string; decision: string; revision_no: number; decided_at: string | null; decided_by_user_id: string | null } | null; current_authoritative_decision: Result['current_validation']; is_evidence_candidate: boolean; latest_revision_no: number; legacy_unresolved: boolean; created_at: string | null; updated_at: string | null; archived_at: string | null };
export type Entry = { id: string; stage_id: string; category_id: string; institution_id: string | null; representing_organization_id: string | null; entry_type: 'INDIVIDUAL' | 'TEAM'; status: string; regulation_version_id: string; created_at: string | null };
export type Qualification = { id: string; source_entry_id: string; source_stage_id: string; destination_stage_id: string; destination_entry_id: string | null; regulation_version_id: string; decision_type: 'RESULT_BASED' | 'MANUAL'; status: string; reason: string | null; decided_at: string | null };
export type Ranking = { id: string; stage_id: string; occurrence_id: string | null; event_id: string; category_id: string; regulation_version_id: string; ranking_type: 'EVENT' | 'CATEGORY' | 'STAGE'; calculation_version: string; status: string; supersedes_ranking_id: string | null; current?: boolean; rows?: RankingRow[] };
export type RankingRow = { id: string; competition_entry_id: string; position: number; points: number | null };
export type Award = { id: string; ranking_id: string | null; competition_entry_id: string; award_type: string; label: string | null; regulation_version_id: string; status: string; issued_by_user_id: string | null; issued_at: string | null; revoked_by_user_id: string | null; revoked_at: string | null };
export type Eligibility = { id: string; stage_id: string; scope_type: 'ORGANIZATION' | 'DAIRA' | 'INSTITUTION'; organization_id: string | null; daira_id: number | null; institution_id: string | null };
export type PageQuery = { limit?: number; offset?: number };

const query = (value: Record<string, unknown>) => {
  const pairs = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([key, value]) => [key, String(value)]);
  return pairs.length ? `?${new URLSearchParams(pairs).toString()}` : '';
};

function normalizedCode(value: unknown): ApiErrorCode {
  const code = String(value ?? 'INTERNAL_ERROR').toUpperCase();
  return ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INVALID_STATE', 'INVALID_CONTEXT', 'VALIDATION_ERROR', 'RATE_LIMITED', 'INTERNAL_ERROR'].includes(code) ? code as ApiErrorCode : 'INTERNAL_ERROR';
}

export class CompetitionApi {
  constructor(private token: string, private fetcher: typeof fetch = fetch) {}
  private async request<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
    const response = await this.fetcher(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${this.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = body?.error;
      if (typeof error === 'object') throw new CompetitionApiError(normalizedCode(error.code), error.message ?? 'تعذر إتمام الطلب', error.request_id ?? response.headers.get('x-request-id') ?? undefined, response.status);
      throw new CompetitionApiError(normalizedCode(error), 'تعذر إتمام الطلب', response.headers.get('x-request-id') ?? undefined, response.status);
    }
    return body as Envelope<T>;
  }
  get<T>(path: string, params: Record<string, unknown> = {}) { return this.request<T>(`${path}${query(params)}`); }
  post<T>(path: string, body?: unknown) { return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }); }
  delete<T>(path: string) { return this.request<T>(path, { method: 'DELETE' }); }

  references = {
    stages: (params: PageQuery & { competition_id?: string; status?: string } = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/stages', params),
    occurrences: (stage_id: string, params: PageQuery = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/occurrences', { stage_id, ...params }),
    events: (stage_id: string, params: PageQuery = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/events', { stage_id, ...params }),
    categories: (stage_id: string, params: PageQuery = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/categories', { stage_id, ...params }),
    regulationVersions: (stage_id: string, params: PageQuery = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/regulation-versions', { stage_id, ...params }),
    teams: (stage_id: string, category_id?: string, params: PageQuery = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/teams', { stage_id, category_id, ...params }),
    dairas: (params: PageQuery & { wilaya_id?: number } = {}) => this.get<DairaReference[]>('/api/v1/admin/competition-reference/dairas', params),
    organizations: (params: PageQuery & { wilaya_id?: number } = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/organizations', params),
    institutions: (params: PageQuery & { organization_id?: string; daira_id?: number } = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/institutions', params),
    participants: (params: PageQuery & { institution_id?: string } = {}) => this.get<Reference[]>('/api/v1/admin/competition-reference/participants', params)
  };
  entries = { list: (params: PageQuery & Record<string, unknown> = {}) => this.get<Entry[]>('/api/v1/admin/competition-entries', params), read: (id: string) => this.get<Entry>(`/api/v1/admin/competition-entries/${id}`), create: (body: unknown) => this.post<Entry>('/api/v1/admin/competition-entries', body), transition: (id: string, action: string) => this.post<Entry>(`/api/v1/admin/competition-entries/${id}/${action}`) };
  results = { list: (params: PageQuery & Record<string, unknown> = {}) => this.get<Result[]>('/api/v1/admin/competition-results', params), read: (id: string) => this.get<Result>(`/api/v1/admin/competition-results/${id}`), history: (id: string, params: PageQuery = {}) => this.get<{ result: Result; revisions: unknown[]; validations: unknown[] }>(`/api/v1/admin/competition-results/${id}/history`, params), create: (body: unknown) => this.post<Result>('/api/v1/admin/competition-results', body), submit: (id: string) => this.post<Result>(`/api/v1/admin/competition-results/${id}/submit`), revise: (id: string, body: unknown) => this.post<unknown>(`/api/v1/admin/competition-results/${id}/revisions`, body), decision: (id: string, decision: 'validated' | 'rejected' | 'void', body: unknown) => this.post<unknown>(`/api/v1/admin/competition-results/${id}/${decision}`, body), archive: (id: string) => this.post<Result>(`/api/v1/admin/competition-results/${id}/archive`) };
  qualifications = { list: (params: PageQuery & Record<string, unknown> = {}) => this.get<Qualification[]>('/api/v1/admin/qualifications', params), read: (id: string) => this.get<{ qualification: Qualification; evidence: unknown[] }>(`/api/v1/admin/qualifications/${id}`), create: (body: unknown) => this.post<Qualification>('/api/v1/admin/qualifications', body), evidence: (id: string, resultId: string, resultValidationId: string) => this.post<unknown>(`/api/v1/admin/qualifications/${id}/evidence`, { resultId, resultValidationId }), transition: (id: string, action: string) => this.post<Qualification>(`/api/v1/admin/qualifications/${id}/${action}`) };
  rankings = { list: (params: PageQuery & Record<string, unknown> = {}) => this.get<Ranking[]>('/api/v1/admin/rankings', params), read: (id: string) => this.get<Ranking>(`/api/v1/admin/rankings/${id}`), current: (params: { stageId: string; eventId: string; categoryId: string; rankingType: string }) => this.get<Ranking | null>('/api/v1/admin/rankings/current', params), create: (body: unknown) => this.post<Ranking>('/api/v1/admin/rankings', body), input: (id: string, resultId: string, resultValidationId: string) => this.post<unknown>(`/api/v1/admin/rankings/${id}/inputs`, { resultId, resultValidationId }), removeInput: (id: string, inputId: string) => this.delete<{ id: string }>(`/api/v1/admin/rankings/${id}/inputs/${inputId}`), row: (id: string, body: unknown) => this.post<RankingRow>(`/api/v1/admin/rankings/${id}/rows`, body), removeRow: (id: string, rowId: string) => this.delete<{ id: string }>(`/api/v1/admin/rankings/${id}/rows/${rowId}`), transition: (id: string, action: string) => this.post<Ranking>(`/api/v1/admin/rankings/${id}/${action}`) };
  awards = { list: (params: PageQuery & Record<string, unknown> = {}) => this.get<Award[]>('/api/v1/admin/awards', params), read: (id: string) => this.get<Award>(`/api/v1/admin/awards/${id}`), create: (body: unknown) => this.post<Award>('/api/v1/admin/awards', body), transition: (id: string, action: string) => this.post<Award>(`/api/v1/admin/awards/${id}/${action}`) };
  eligibility = { list: (stageId: string) => this.get<Eligibility[]>(`/api/v1/admin/competition-stages/${stageId}/eligibility`), add: (stageId: string, body: unknown) => this.post<Eligibility>(`/api/v1/admin/competition-stages/${stageId}/eligibility`, body), remove: (stageId: string, eligibilityId: string) => this.delete<{ id: string }>(`/api/v1/admin/competition-stages/${stageId}/eligibility/${eligibilityId}`) };
}

export function dependentSelection<T extends Record<string, string>>(state: T, key: keyof T, value: string, reset: (keyof T)[]): T {
  const next = { ...state, [key]: value } as T;
  for (const field of reset) next[field] = '' as T[keyof T];
  return next;
}
export function errorMessage(error: unknown) { if (!(error instanceof CompetitionApiError)) return 'تعذر الاتصال بالخادم'; const messages: Record<ApiErrorCode, string> = { UNAUTHORIZED: 'انتهت الجلسة، سجّل الدخول مجدداً.', FORBIDDEN: 'ليس لديك نطاق أو صلاحية لهذا الإجراء.', NOT_FOUND: 'المورد المطلوب غير موجود.', CONFLICT: 'تعارض الإجراء مع تغيير حديث.', INVALID_STATE: 'لا يمكن تنفيذ الإجراء في الحالة الحالية.', INVALID_CONTEXT: 'السياق أو المورد المرجعي غير متوافق.', VALIDATION_ERROR: 'تحقق من الحقول المطلوبة.', RATE_LIMITED: 'تم تجاوز الحد المؤقت؛ حاول لاحقاً.', INTERNAL_ERROR: 'تعذر إتمام العملية بأمان.' }; return `${messages[error.code]}${error.code === 'INTERNAL_ERROR' && error.requestId ? ` المرجع: ${error.requestId}` : ''}`; }
