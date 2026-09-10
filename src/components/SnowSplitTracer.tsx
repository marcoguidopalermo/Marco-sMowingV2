// ONE WIDE DRIVEWAY, SPLIT BETWEEN TWO PROPERTIES.
//
// A shared driveway is not two driveways. It is one slab with two owners, and
// the previous layout — a small tracer with a larger one stacked under it —
// looked like nothing on the ground. This draws what is actually there: a
// single tracer with a line down it. Everything LEFT of the line is Driveway 1,
// everything RIGHT is Driveway 2, and each side is tiered and priced from its
// own cells.
//
// THE DIVIDER IS DRAGGABLE, because the split is often not even — a 4-wide
// driveway can be 1/3 or 3/1. It snaps to the nearest column boundary (there is
// no such thing as half a parking spot), and it carries arrow buttons as well,
// because dragging a thin line is a poor target on a phone in a driveway.
import { useRef } from 'react';
import { Car, ChevronLeft, ChevronRight } from 'lucide-react';

const GREEN = '#1c4634';
const GOLD = '#cdbd8f';
const DIVIDER = '#b45309';

export default function SnowSplitTracer({
  grid, cols, splitCol, onSplit, onCycle, label1, label2,
}: {
  grid: number[][];
  cols: number;
  /** Columns [0, splitCol) are Driveway 1; [splitCol, cols) are Driveway 2. */
  splitCol: number;
  onSplit: (c: number) => void;
  onCycle: (r: number, c: number) => void;
  label1: string;
  label2: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Snap to the nearest boundary, never past the ends — each side must keep at
  // least one column or it is not a shared driveway.
  const setFromClientX = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const frac = (clientX - r.left) / r.width;
    const nearest = Math.round(frac * cols);
    onSplit(Math.min(cols - 1, Math.max(1, nearest)));
  };
  const startDrag = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    setFromClientX(e.clientX);
  };

  const pct = (splitCol / cols) * 100;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
          Trace the shared driveway
        </div>
        <div className="text-[10px] font-bold text-slate-400">Tap: empty → spot → DRAG</div>
      </div>
      <div className="text-[10px] text-slate-400 mb-2">
        One driveway, two owners. Drag the line to where the split actually falls.
      </div>

      {/* Side labels, aligned to the two halves so it is obvious at a glance
          which cells belong to whom. */}
      <div className="flex mb-1 text-[10px] font-black uppercase tracking-widest">
        <div className="text-center truncate" style={{ width: `${pct}%`, color: GREEN }}>{label1}</div>
        <div className="text-center truncate" style={{ width: `${100 - pct}%`, color: DIVIDER }}>{label2}</div>
      </div>

      <div ref={wrapRef} className="relative">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {grid.map((row, r) => row.map((v, c) => (
            <button key={`${r}-${c}`} onClick={() => onCycle(r, c)}
              aria-label={`${c < splitCol ? label1 : label2}, row ${r + 1} column ${c + 1}: ${v === 0 ? 'empty' : v === 1 ? 'spot' : 'drag'}`}
              className="aspect-square rounded-xl flex flex-col items-center justify-center transition-colors select-none"
              style={
                v === 1 ? { backgroundColor: GREEN, color: 'white' }
                  : v === 2 ? { backgroundColor: '#c9d8cf', color: GREEN, border: `2px dashed ${GREEN}` }
                    : { backgroundColor: '#f1f5f9', border: '2px dashed #cbd5e1', color: '#94a3b8' }
              }>
              {v === 1 && <Car className="w-6 h-6" />}
              {v === 2 && <span className="text-[11px] font-black uppercase tracking-widest">Drag</span>}
            </button>
          )))}
        </div>

        {/* THE LINE. Sits over the grid, not between two grids, because there is
            one slab underneath. pointer-events only on the handle so tapping a
            cell still cycles it. */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{ left: `calc(${pct}% - 2px)`, width: 4, backgroundColor: DIVIDER, borderRadius: 2 }}
        />
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          role="separator"
          aria-label="Drag to move the split between the two properties"
          aria-valuenow={splitCol}
          className="absolute top-0 bottom-0 cursor-ew-resize touch-none"
          style={{ left: `calc(${pct}% - 14px)`, width: 28 }}
        >
          <div
            className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 rounded-full shadow-lg flex items-center justify-center"
            style={{ width: 26, height: 26, backgroundColor: DIVIDER, color: 'white' }}
          >
            <ChevronLeft className="w-3 h-3 -mr-1" /><ChevronRight className="w-3 h-3 -ml-1" />
          </div>
        </div>
      </div>

      <div className="mt-2 rounded-full h-3" style={{ backgroundColor: GOLD }} />
      <div className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Street</div>

      {/* Dragging a 4px line is a poor target in a driveway in February. */}
      <div className="flex items-center justify-center gap-2 mt-2">
        <button onClick={() => onSplit(Math.max(1, splitCol - 1))} disabled={splitCol <= 1}
          className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-bold text-slate-500">
          {splitCol} / {cols - splitCol} split
        </span>
        <button onClick={() => onSplit(Math.min(cols - 1, splitCol + 1))} disabled={splitCol >= cols - 1}
          className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
