import { describe, expect, it, vi } from 'vitest';
import { CompetitionApi, dependentSelection } from './api';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CompetitionApi contract', () => {
  it('loads competition overview records through the admin endpoint', async () => { const fetcher = vi.fn().mockResolvedValue(response({ data: [{ id: 'c1', season_id: 's1', season_name: 'موسم تجريبي', name: 'منافسة', status: 'ACTIVE', start_date: null, end_date: null }] })); const result = await new CompetitionApi('token', fetcher as unknown as typeof fetch).competitions.list(); expect(fetcher.mock.calls[0][0]).toContain('/api/v1/admin/competitions'); expect(result.data[0].season_name).toBe('موسم تجريبي'); });
  it('parses ARCH-015 collection envelopes and Result validation candidates', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ id: 'result-1', governed_status: 'VALIDATED', current_validation: { id: 'validation-1', decision: 'VALIDATED', revision_no: 2, decided_at: null, decided_by_user_id: null }, is_evidence_candidate: true, official_payload: { score: 3 }, legacy_unresolved: false }], meta: { pagination: { limit: 25, offset: 0, total: 1 } } }));
    const result = await new CompetitionApi('token', fetcher as unknown as typeof fetch).results.list({ evidence_candidate: 'true' });
    expect(fetcher.mock.calls[0][0]).toContain('evidence_candidate=true');
    expect(result.meta?.pagination?.total).toBe(1);
    expect(result.data[0].current_validation?.id).toBe('validation-1');
    expect(result.data[0].is_evidence_candidate).toBe(true);
  });

  it('invokes the native-compatible fetch function without binding it to the API client', async () => {
    let receiver: unknown = 'not-called';
    const fetcher = function (this: unknown) { receiver = this; return Promise.resolve(response({ data: [] })); };
    await new CompetitionApi('token', fetcher as unknown as typeof fetch).entries.list();
    expect(receiver).toBeUndefined();
  });

  it('preserves stable error code and request id without parsing the error message', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { code: 'RATE_LIMITED', message: 'retry later', request_id: 'req-123' } }, 429));
    await expect(new CompetitionApi('token', fetcher as unknown as typeof fetch).references.stages()).rejects.toMatchObject({ code: 'RATE_LIMITED', requestId: 'req-123', status: 429 });
  });

  it('uses the governed Result archive endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: { id: 'r1', governed_status: 'ARCHIVED' } }));
    await new CompetitionApi('token', fetcher as unknown as typeof fetch).results.archive('r1');
    expect(fetcher.mock.calls[0][0]).toContain('/api/v1/admin/competition-results/r1/archive');
    expect(fetcher.mock.calls[0][1].method).toBe('POST');
  });

  it('clears stale dependent references when an upstream selection changes', () => {
    expect(dependentSelection({ stage: 'old', category: 'category', version: 'version', team: 'team' }, 'stage', 'new', ['category', 'version', 'team'])).toEqual({ stage: 'new', category: '', version: '', team: '' });
  });
});
