// Dry-run for RoleMaster v1.5 recurrence: yearly, bounded window, seasonal band.
// Verifies frontend lib and functions mirror agree. Run: npx tsx scripts/dryrun-v15.ts
import { computeOccurrences as feOcc, dateGenerable as feGen } from '../src/lib/roleMaster';

// Inline copy of the functions mirror gate so we can assert they agree without
// importing the admin-SDK module.
function fnInSeason(date: string, sw?: { fromMonthDay: string; toMonthDay: string }): boolean {
  if (!sw || !sw.fromMonthDay || !sw.toMonthDay) return true;
  const md = date.slice(5); const from = sw.fromMonthDay; const to = sw.toMonthDay;
  return from <= to ? (md >= from && md <= to) : (md >= from || md <= to);
}
function fnInActive(date: string, from?: string, until?: string): boolean {
  if (from && date < from) return false;
  if (until && date > until) return false;
  return true;
}
const fnGen = (date: string, d: any) => fnInActive(date, d.activeFrom, d.activeUntil) && fnInSeason(date, d.seasonWindow);

const genWindow = (today: string, horizon = 31) => {
  const ms = (s: string) => Date.parse(`${s}T12:00:00Z`);
  const d = (m: number) => new Date(m).toISOString().slice(0, 10);
  return { from: d(ms(today) + 86400000), to: d(ms(today) + horizon * 86400000) };
};

function materialized(today: string, duty: any) {
  const { from, to } = genWindow(today);
  const occ = computeOcc(duty.recurrence, from, to);
  const fe = occ.filter((date) => feGen(date, duty));
  const fn = occ.filter((date) => fnGen(date, duty));
  const agree = JSON.stringify(fe) === JSON.stringify(fn);
  return { fe, agree };
}
function computeOcc(rec: any, from: string, to: string) { return feOcc(rec, from, to); }

let pass = 0; let fail = 0;
function check(label: string, cond: boolean, detail: string) {
  (cond ? (pass++) : (fail++));
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`);
}

// 1) YEARLY Mar 15, today Feb 20 → in horizon → generates once.
{
  const duty = { recurrence: { kind: 'yearly', month: 3, day: 15 } };
  const { fe, agree } = materialized('2026-02-20', duty);
  check('yearly Mar 15 in horizon', fe.length === 1 && fe[0] === '2026-03-15', `dates=${JSON.stringify(fe)}`);
  check('  yearly fe/fn agree', agree, '');
  // Out of horizon (today Jan 1 → to Feb 1) → none.
  const off = materialized('2026-01-01', duty);
  check('yearly Mar 15 out of horizon', off.fe.length === 0, `dates=${JSON.stringify(off.fe)}`);
}

// 2) BOUNDED weekly Friday, window 2026-06-05..2026-08-01. Inside July: fires.
{
  const duty = { recurrence: { kind: 'weekly', dayOfWeek: 5 }, activeFrom: '2026-06-05', activeUntil: '2026-08-01' };
  const inside = materialized('2026-07-06', duty); // all Fridays Jul 7? no, Jul 10,17,24,31,Aug7(out)
  const allInWindow = inside.fe.every((d) => d >= '2026-06-05' && d <= '2026-08-01');
  check('bounded weekly fires inside window', inside.fe.length > 0 && allInWindow, `dates=${JSON.stringify(inside.fe)}`);
  check('  bounded fe/fn agree', inside.agree, '');
  // After activeUntil: today Aug 10 → nothing (all past window end).
  const after = materialized('2026-08-10', duty);
  check('bounded weekly silent past activeUntil', after.fe.length === 0, `dates=${JSON.stringify(after.fe)}`);
  // The Aug 7 Friday (just past window) must be excluded when today=Jul 31.
  const edge = materialized('2026-07-31', duty);
  check('bounded weekly excludes Aug 7 (past end)', !edge.fe.includes('2026-08-07'), `dates=${JSON.stringify(edge.fe)}`);
}

// 3) SEASONAL May1–Oct30 weekly, today July → generates; dormant date is a Nov Friday.
{
  const duty = { recurrence: { kind: 'weekly', dayOfWeek: 5 }, seasonWindow: { fromMonthDay: '05-01', toMonthDay: '10-30' } };
  const july = materialized('2026-07-06', duty);
  check('seasonal weekly active in July', july.fe.length > 0, `dates=${JSON.stringify(july.fe)}`);
  check('  seasonal fe/fn agree', july.agree, '');
  // Late Oct: today Oct 20 → Fridays up to Oct 30 fire, Nov Fridays dormant.
  const octEdge = materialized('2026-10-20', duty);
  const noNov = octEdge.fe.every((d) => d <= '2026-10-30');
  check('seasonal weekly dormant after Oct 30', noNov, `dates=${JSON.stringify(octEdge.fe)}`);
  // Deep winter: today Dec 15 → nothing.
  const winter = materialized('2026-12-15', duty);
  check('seasonal weekly fully dormant in Dec', winter.fe.length === 0, `dates=${JSON.stringify(winter.fe)}`);
}

// 4) YEAR-WRAP Nov1–Mar31 weekly. today Jan → fires; today July → dormant.
{
  const duty = { recurrence: { kind: 'weekly', dayOfWeek: 5 }, seasonWindow: { fromMonthDay: '11-01', toMonthDay: '03-31' } };
  const jan = materialized('2027-01-10', duty);
  check('year-wrap band fires in Jan', jan.fe.length > 0 && jan.fe.every((d) => d.slice(5) >= '11-01' || d.slice(5) <= '03-31'), `dates=${JSON.stringify(jan.fe)}`);
  check('  year-wrap fe/fn agree', jan.agree, '');
  const jul = materialized('2026-07-06', duty);
  check('year-wrap band dormant in July', jul.fe.length === 0, `dates=${JSON.stringify(jul.fe)}`);
  // Edge across New Year: today Dec 25 → horizon into Jan, all fire (still in band).
  const nye = materialized('2026-12-25', duty);
  check('year-wrap band spans New Year', nye.fe.length > 0, `dates=${JSON.stringify(nye.fe)}`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
