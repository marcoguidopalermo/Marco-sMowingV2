// Shared "stamped/sealed" badge — the rotated double-border look used for
// the Performance Board "Approved" seal and the Repair Board parts-waiting
// stamp. Pure presentation; no logic.

export type StampColor = 'emerald' | 'amber' | 'rose' | 'slate';

interface StampProps {
  label: string;
  color?: StampColor;
  // Rotation in degrees (Performance Board uses -4).
  rotate?: number;
  // 'md' matches the Performance Board approved stamp exactly; 'sm' is the
  // compact variant for small cards (repair board corner).
  size?: 'sm' | 'md';
  title?: string;
  // Extra classes for positioning (e.g. absolute overlay on a relative card).
  className?: string;
}

const COLOR_CLS: Record<StampColor, string> = {
  emerald: 'border-emerald-700 text-emerald-700',
  amber: 'border-amber-600 text-amber-700',
  rose: 'border-rose-600 text-rose-700',
  slate: 'border-slate-500 text-slate-600',
};

export default function Stamp({
  label,
  color = 'emerald',
  rotate = -4,
  size = 'md',
  title,
  className = '',
}: StampProps) {
  const sizeCls = size === 'sm'
    ? 'px-1.5 py-0.5 text-[9px] tracking-[0.15em] border-2'
    : 'px-3 py-1 text-sm tracking-[0.25em] border-[3px]';
  return (
    <div
      className={`inline-block border-double font-black uppercase opacity-85 select-none ${sizeCls} ${COLOR_CLS[color]} ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
      title={title}
    >
      {label}
    </div>
  );
}
