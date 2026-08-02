// Tests for the Month Sheets analysis layer.  npx tsx src/lib/monthAnalysis.test.ts
import assert from 'node:assert/strict';
import { crewDayRows, monthStats, sortCrewDayRows, bhOf, ahOf } from './monthAnalysis';

let pass = 0, fail = 0;
const test = (n: string, fn: () => void) => { try { fn(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fail++; console.error(`  ✗ ${n}\n      ${(e as Error).message}`); } };
const cd = (division: string, crewNumber: number, bh: number, ah: number, status = 'approved') =>
  ({ division, crewNumber, isAdHoc: false, jobs: bh ? [{ bh }] : [], employeeAH: ah ? { e1: ah } : {}, approvalStatus: status } as any);

const days = {
  '2026-06-02': { a: cd('Lawn Division', 1, 60, 48), b: cd('Small Projects', 1, 40, 50) },   // lawn 125%, small 80%
  '2026-06-03': { c: cd('Lawn Division', 1, 30, 40), d: cd('Lawn Division', 2, 0, 0, 'waived') }, // 75%, empty waived
};

console.log('monthAnalysis:');
test('bhOf / ahOf sum rows', () => {
  assert.equal(bhOf(cd('L', 1, 60, 48)), 60);
  assert.equal(ahOf(cd('L', 1, 60, 48)), 48);
});
test('crewDayRows: one row per crew-day with eff = BH/AH', () => {
  const rows = crewDayRows(days);
  assert.equal(rows.length, 4);
  const a = rows.find(r => r.crewId === 'a')!;
  assert.equal(a.bh, 60); assert.equal(a.ah, 48); assert.equal(a.eff, 125);
  const d = rows.find(r => r.crewId === 'd')!;
  assert.equal(d.eff, null); // no AH
});
test('monthStats: totals, division averages (BH/AH weighted), best/worst day', () => {
  const s = monthStats(days);
  assert.equal(s.crewDayCount, 4);
  assert.equal(s.dayCount, 2);
  assert.equal(s.totalBH, 130);          // 60+40+30
  assert.equal(s.totalAH, 138);          // 48+50+40
  // Lawn division: (60+30)/(48+40) = 90/88 = 102%
  const lawn = s.divisions.find(d => d.division === 'Lawn Division')!;
  assert.equal(lawn.eff, 102);
  assert.equal(lawn.crewDays, 3);
  const small = s.divisions.find(d => d.division === 'Small Projects')!;
  assert.equal(small.eff, 80);
  // Best day 06-02: (60+40)/(48+50)=100/98=102%; worst 06-03: 30/40=75%
  assert.equal(s.bestDay!.date, '2026-06-02'); assert.equal(s.bestDay!.eff, 102);
  assert.equal(s.worstDay!.date, '2026-06-03'); assert.equal(s.worstDay!.eff, 75);
});
test('sortCrewDayRows: worst-first / best-first; null-AH rows last', () => {
  const rows = crewDayRows(days);
  const worst = sortCrewDayRows(rows, 'worst');
  assert.equal(worst[0].crewId, 'c');   // 75%
  assert.equal(worst[worst.length - 1].eff, null); // empty last
  const best = sortCrewDayRows(rows, 'best');
  assert.equal(best[0].crewId, 'a');    // 125%
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
