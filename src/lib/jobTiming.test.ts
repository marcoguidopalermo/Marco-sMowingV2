import { describe, expect, test } from 'vitest';
import {
  aggregateJobs, divisionStats, filterRecords, jobTitleOf, JobTimingRecord, median, presetRange, rankJobs, TimingFilters,
} from './jobTiming';

let n = 0;
const rec = (p: Partial<JobTimingRecord>): JobTimingRecord => ({
  visitId: `v${++n}`, jobId: 'J1', jobNumber: '4264', title: 'Rosemarie Sorochuk - Weekly [.7]', bh: 0.7, hourly: false,
  recurring: true, lineItems: [], propertyId: 'P1', propertyLabel: 'Rosemarie Sorochuk — 224 Victoria Avenue West',
  clientId: 'C1', clientName: 'Rosemarie Sorochuk', lush: false, date: '2026-09-01', lastDate: '2026-09-01', month: '2026-09',
  dayList: ['2026-09-01'], division: 'Lawn Division', crewKey: 'lawn division-3', crewLabel: 'Lawn Division #3', crewSize: 1,
  headcount: 1, labourHours: 0.7, method: 'all timed', quality: 'full', efficiency: 1, timedPeople: 1, days: {}, updatedAt: 0,
  details: { property: { address: { street: '224 Victoria Avenue West', city: 'Thunder Bay' } } },
  ...p,
});
const ALL: TimingFilters = { from: '2026-04-01', to: '2026-12-31', division: '', crewKey: '', includeNoCrew: false };

describe('job timing trends', () => {
  test('groups by Jobber job, so a cleanup is never averaged with the weekly cut', () => {
    const recs = [
      rec({ date: '2026-08-01' }), rec({ date: '2026-08-08' }), rec({ date: '2026-08-15' }),
      rec({ jobId: 'J2', jobNumber: '4459', title: 'Rosemarie Sorochuk - DeWeeding + Edging [5.8]', bh: 5.8, labourHours: 19.9,
        division: 'Small Projects', crewKey: 'small projects-2', crewLabel: 'Small Projects #2' }),
    ];
    const rows = aggregateJobs(recs, divisionStats(recs));
    expect(rows).toHaveLength(2);
    const mow = rows.find(r => r.jobId === 'J1')!;
    expect(mow.visits).toBe(3);
    expect(mow.medianLabour).toBe(0.7);
    expect(mow.jobTitle).toBe('Weekly');
    expect(mow.address).toBe('224 Victoria Avenue West, Thunder Bay');
    expect(rows.every(r => r.propertyId === 'P1')).toBe(true);
  });

  test('median ignores one runaway timer; the row is flagged', () => {
    const recs = [0.7, 0.7, 0.75, 0.7, 4.0].map((h, i) => rec({ date: `2026-08-0${i + 1}`, labourHours: h }));
    const [row] = aggregateJobs(recs, divisionStats(recs));
    expect(row.medianLabour).toBe(0.7);
    expect(row.medianEfficiency).toBeCloseTo(1, 5);
    expect(row.efficiency).toBeLessThan(0.6);   // average dragged down by the 4h visit
    expect(row.skewed).toBe(true);
  });

  test('a steady job is not flagged', () => {
    const recs = [0.7, 0.72, 0.68, 0.7].map((h, i) => rec({ date: `2026-08-0${i + 1}`, labourHours: h }));
    expect(aggregateJobs(recs, divisionStats(recs))[0].skewed).toBe(false);
  });

  test('ranks by median vs the division median, slowest first by default', () => {
    const slow = [1.4, 1.4, 1.4].map(h => rec({ jobId: 'S', labourHours: h }));
    const fast = [0.5, 0.5, 0.5].map(h => rec({ jobId: 'F', labourHours: h }));
    const recs = [...slow, ...fast];
    const rows = aggregateJobs(recs, divisionStats(recs));
    expect(rankJobs(rows, 'under')[0].jobKey).toBe('S');
    expect(rankJobs(rows, 'over')[0].jobKey).toBe('F');
  });

  test('median of even and odd lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test('last 8 weeks is 56 days ending today', () => {
    expect(presetRange('8w', '2026-09-28')).toEqual({ from: '2026-08-04', to: '2026-09-28' });
    expect(presetRange('season', '2026-09-28').from).toBe('2026-04-01');
  });

  test('crew, division and date filters each narrow the set', () => {
    const recs = [
      rec({ date: '2026-05-10' }),
      rec({ date: '2026-09-10', crewKey: 'lawn division-4', crewLabel: 'Lawn Division #4' }),
      rec({ date: '2026-09-11', division: 'Small Projects', crewKey: 'small projects-1' }),
      rec({ date: '2026-09-12', crewKey: 'lawn division-3+lawn division-4' }),
    ];
    expect(filterRecords(recs, { ...ALL, ...presetRange('8w', '2026-09-28') })).toHaveLength(3);
    expect(filterRecords(recs, { ...ALL, division: 'Small Projects' })).toHaveLength(1);
    expect(filterRecords(recs, { ...ALL, crewKey: 'lawn division-4' })).toHaveLength(2);
  });

  test('job title drops the client name prefix and the BH tag', () => {
    expect(jobTitleOf('*Anne Redfern - Biweekly [.8]', 'Anne Redfern')).toBe('Biweekly');
    expect(jobTitleOf('(Front Only) Kathy Reinhold - Weekly [.6]', 'Kathy Reinhold')).toBe('Weekly');
    expect(jobTitleOf('Hedge trimming', 'Carol Mundell')).toBe('Hedge trimming');
  });
});
