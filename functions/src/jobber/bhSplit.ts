// MULTI-CREW BH SPLIT — the headcount rule, single source of truth.
//
// Lifted verbatim out of the performance sync so job timing splits a
// multi-crew visit's BH exactly as the sync credits it. Pure: crew ids,
// their headcounts and the visit total in; per-crew shares out.

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Splits a visit's BH across crews in proportion to headcount (evenly when
 * nobody is counted), with rounding drift landed on the largest share so the
 * shares sum exactly to the total.
 * @param {string[]} crewIds Crews the visit matched, in order.
 * @param {number[]} heads Headcount of each crew (same order).
 * @param {number} totalBH The visit's BH.
 * @return {Array} Per-crew shares.
 */
export function headcountSplit(
  crewIds: string[],
  heads: number[],
  totalBH: number,
): Array<{crewId: string; bh: number}> {
  const totalHead = heads.reduce((a, b) => a + b, 0);
  let result: Array<{crewId: string; bh: number}>;
  if (totalHead === 0) {
    const per = round2(totalBH / crewIds.length);
    result = crewIds.map((c) => ({crewId: c, bh: per}));
  } else {
    result = crewIds.map((c, i) => ({
      crewId: c,
      bh: round2(totalBH * (heads[i] / totalHead)),
    }));
  }
  // Fix any rounding drift so the sum lands exactly on totalBH.
  const sum = result.reduce((a, s) => a + s.bh, 0);
  const drift = round2(totalBH - sum);
  if (Math.abs(drift) >= 0.005) {
    let maxIdx = 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].bh > result[maxIdx].bh) maxIdx = i;
    }
    result[maxIdx] = {
      ...result[maxIdx],
      bh: round2(result[maxIdx].bh + drift),
    };
  }
  return result;
}
