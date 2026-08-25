// THE TRACED DRIVEWAY, in a shape Firestore will actually store.
//
// SnowQuote used to hold `grid: number[][]`. Firestore does not allow an array
// inside an array — every save was rejected with a hard 400 ("Nested arrays are
// not allowed"), and because the write had no catch, the estimator saw the form
// close and nothing else. Zero quotes were ever stored.
//
// Rows become STRINGS: one character per cell, one string per row. It writes,
// it is smaller than the numeric form, and it is legible in the console — a
// traced driveway reads as a shape rather than as a wall of digits.
//
//   [[0,1,1],[0,2,1]]  ->  ["011", "021"]
//
// Cells are 0 empty · 1 open · 2 drag, which is what the estimator's grid uses.

export type SnowGrid = number[][];

export const encodeGrid = (grid: SnowGrid | undefined): string[] =>
  (grid || []).map(row => (row || []).map(c => String(Number(c) || 0)).join(''));

export const decodeGridRows = (rows: string[] | undefined): SnowGrid =>
  (rows || []).map(r => String(r || '').split('').map(ch => {
    const n = Number(ch);
    return Number.isFinite(n) ? n : 0;
  }));

/**
 * READ MIGRATION. Takes a quote in any shape it has ever had — or might be
 * given — and returns the grid:
 *
 *   · `gridRows: string[]`   the shape written from now on
 *   · `grid: number[][]`     the shape the type declared but Firestore refused;
 *                            it can still arrive from a client that never
 *                            reloaded, or from a hand-repaired document
 *   · neither                an empty grid, never a crash
 *
 * Nothing on the server is in the legacy shape (the writes all failed), but a
 * reader that assumes that is a reader that breaks the day somebody restores a
 * document by hand.
 */
export function gridOf(q: { gridRows?: string[]; grid?: unknown } | null | undefined): SnowGrid {
  if (!q) return [];
  if (Array.isArray(q.gridRows) && q.gridRows.length > 0) return decodeGridRows(q.gridRows);
  if (Array.isArray(q.grid)) {
    // Guard the element type: a hand-edited document could hold strings here.
    return (q.grid as unknown[]).map(row =>
      Array.isArray(row) ? row.map(c => Number(c) || 0)
        : typeof row === 'string' ? row.split('').map(ch => Number(ch) || 0)
          : []);
  }
  return [];
}

/** Cells actually traced — used for the "nothing traced yet" guard. */
export const gridCellCount = (grid: SnowGrid): number =>
  grid.reduce((n, row) => n + row.filter(c => c > 0).length, 0);
