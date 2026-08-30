import { describe, expect, it, vi } from 'vitest';
import { PublicApiError, publicApi, type PublicAward, type PublicRecord, type PublicResult } from './public-api';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('public API contracts', () => {
  it('loads official awards through the public endpoint', async () => {
    const award: PublicAward = { id: 'award-1', award_type: 'MEDAL', label: 'المرتبة الأولى', status: 'ISSUED', issued_at: null, ranking_type: 'EVENT', calculation_version: 'v1', competition_id: 'competition-1', competition_name: 'المنافسة', season_name: '2025/2026', stage_level_code: 'NATIONAL', category_name: 'فئة', event_name: 'سباق', competitor_name: 'فريق المدرسة', source: 'OFFICIAL' };
    const fetcher = vi.fn().mockResolvedValue(response({ data: [award] }));
    const result = await publicApi.awards(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/v1/public/awards'));
    expect(result.data).toEqual([award]);
  });

  it('preserves empty official awards responses', async () => { expect((await publicApi.awards(vi.fn().mockResolvedValue(response({ data: [] })) as unknown as typeof fetch)).data).toEqual([]); });

  it('loads current official records through the public endpoint', async () => {
    const record: PublicRecord = { id: 'record-1', ranking_type: 'CATEGORY', status: 'PUBLISHED', calculation_version: 'v1', competition_id: 'competition-1', competition_name: 'المنافسة', season_name: '2025/2026', stage_level_code: 'WILAYA', event_name: 'سباق', category_name: 'فئة', source: 'OFFICIAL', recognized_at: null };
    const fetcher = vi.fn().mockResolvedValue(response({ data: [record] }));
    expect((await publicApi.records(fetcher as unknown as typeof fetch)).data).toEqual([record]);
    expect(fetcher.mock.calls[0][0]).toContain('/api/v1/public/records');
  });

  it('preserves empty official records responses', async () => { expect((await publicApi.records(vi.fn().mockResolvedValue(response({ data: [] })) as unknown as typeof fetch)).data).toEqual([]); });

  it('returns a safe public error without exposing backend response text', async () => { await expect(publicApi.awards(vi.fn().mockResolvedValue(response({ error: { message: 'postgres password secret' } }, 500)) as unknown as typeof fetch)).rejects.toBeInstanceOf(PublicApiError); });

  it('keeps the result DTO limited to the governed public fields', async () => {
    const result: PublicResult = { id: 'result-1', competition_name: 'المنافسة', season_name: '2025/2026', stage_level_code: 'NATIONAL', event_name: 'سباق', category_name: 'فئة', held_at: null, entry_type: 'TEAM', competitor_name: 'فريق', position: 1, points: 10, status: 'OFFICIAL', published_at: null };
    const fetcher = vi.fn().mockResolvedValue(response({ data: [result] }));
    const loaded = await publicApi.results(fetcher as unknown as typeof fetch);
    expect(loaded.data[0]).toEqual(result);
    expect(fetcher.mock.calls[0][0]).toContain('/api/v1/public/results');
    expect(loaded.data[0]).not.toHaveProperty('result_data');
  });
});
