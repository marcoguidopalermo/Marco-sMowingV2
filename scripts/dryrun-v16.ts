// Dry-run for RoleMaster v1.6 duration model. Season presets + custom windows
// all resolve to the SAME storage fields the v1.5 generator already reads
// (seasonWindow / activeFrom / activeUntil), so this verifies both the new
// cases and that frontend ↔ functions duration math agree.
// Run: npx tsx scripts/dryrun-v16.ts
import { computeOccurrences as feOcc, dateGenerable as feGen, seasonResumeDate } from '../src/lib/roleMaster';

// Inline copy of the functions-side gate (mirror of functions/src/jobber/roleMaster.ts).
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
  const occ = feOcc(duty.recurrence, from, to);
  const fe = occ.filter((date) => feGen(date, duty));
  const fn = occ.filter((date) => fnGen(date, duty));
  return { fe, agree: JSON.stringify(fe) === JSON.stringify(fn) };
}

// The season presets, as the editor stores them.
const SUMMER = { fromMonthDay: '05-01', toMonthDay: '10-30' };
const WINTER = { fromMonthDay: '11-01', toMonthDay: '04-30' };
const weekly = { kind: 'weekly', dayOfWeek: 5 }; // Fridays

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`);
};

// (a) INDEFINITE — no duration fields → unchanged, always generates.
{
  const duty = { recurrence: weekly };
  const r = materialized('2026-07-06', duty);
  check('(a) indefinite generates normally in July', r.fe.length > 0, JSON.stringify(r.fe));
  check('(a)   fe/fn agree', r.agree);
}

// (b) SUMMER weekly — generates now (July), dormant December + resume date.
{
  const duty = { recurrence: weekly, season: 'summer', seasonWindow: SUMMER };
  const jul = materialized('2026-07-06', duty);
  check('(b) Summer weekly active in July', jul.fe.length > 0, JSON.stringify(jul.fe));
  check('(b)   fe/fn agree', jul.agree);
  const dec = materialized('2026-12-10', duty);
  check('(b) Summer weekly dormant in December', dec.fe.length === 0, JSON.stringify(dec.fe));
  const resume = seasonResumeDate(duty as any, '2026-12-10');
  check('(b) Summer resume date is next May 1', resume === '2027-05-01', String(resume));
}

// (c) WINTER weekly — dormant now (July), active January, spans year-end.
{
  const duty = { recurrence: weekly, season: 'winter', seasonWindow: WINTER };
  const jul = materialized('2026-07-06', duty);
  check('(c) Winter weekly dormant in July', jul.fe.length === 0, JSON.stringify(jul.fe));
  const jan = materialized('2027-01-10', duty);
  check('(c) Winter weekly active in January', jan.fe.length > 0, JSON.stringify(jan.fe));
  check('(c)   fe/fn agree', jan.agree);
  // Spanning year-end: today Dec 25 → horizon crosses into January, all fire.
  const nye = materialized('2026-12-25', duty);
  const allInBand = nye.fe.every(d => d.slice(5) >= '11-01' || d.slice(5) <= '04-30');
  check('(c) Winter spans year-end (Dec 25 → Jan all generate)', nye.fe.length > 0 && allInBand, JSON.stringify(nye.fe));
}

// (d) CUSTOM Mar 1–Apr 15, REPEAT ANNUALLY ON → seasonWindow band, no year.
{
  const duty = { recurrence: weekly, seasonWindow: { fromMonthDay: '03-01', toMonthDay: '04-15' } };
  const s2027 = materialized('2027-02-20', duty);
  const in2027 = s2027.fe.length > 0 && s2027.fe.every(d => d >= '2027-03-01' && d <= '2027-04-15');
  check('(d) custom annual generates spring 2027', in2027, JSON.stringify(s2027.fe));
  const s2028 = materialized('2028-02-20', duty);
  const in2028 = s2028.fe.length > 0 && s2028.fe.every(d => d >= '2028-03-01' && d <= '2028-04-15');
  check('(d) custom annual generates AGAIN spring 2028', in2028, JSON.stringify(s2028.fe));
  check('(d)   fe/fn agree', s2027.agree && s2028.agree);
  // Dormant outside the band (e.g. September).
  const sep = materialized('2027-09-01', duty);
  check('(d) custom annual dormant in September', sep.fe.length === 0, JSON.stringify(sep.fe));
}

// (e) CUSTOM Mar 1–Apr 15 2026, REPEAT OFF → one-shot bounded, then ends.
{
  const duty = { recurrence: weekly, activeFrom: '2026-03-01', activeUntil: '2026-04-15' };
  const in2026 = materialized('2026-03-10', duty);
  const ok26 = in2026.fe.length > 0 && in2026.fe.every(d => d >= '2026-03-01' && d <= '2026-04-15');
  check('(e) one-shot generates inside its 2026 window', ok26, JSON.stringify(in2026.fe));
  check('(e)   fe/fn agree', in2026.agree);
  const next = materialized('2027-02-20', duty);
  check('(e) one-shot does NOT repeat in 2027 (ended)', next.fe.length === 0, JSON.stringify(next.fe));
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
