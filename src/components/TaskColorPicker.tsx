import { CATEGORY_PALETTE } from '../lib/roleCategories';

// A single row of palette swatches for a task's optional organizing colour.
// Reuses the house CATEGORY_PALETTE (amber/red deliberately excluded there,
// since those read as urgency). value is a palette key or '' for none; a
// "None" chip clears it back to no colour.
interface TaskColorPickerProps {
  value: string;
  onChange: (key: string) => void;
}

export default function TaskColorPicker({ value, onChange }: TaskColorPickerProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        title="No colour"
        onClick={() => onChange('')}
        className={`h-6 px-2 rounded-full border text-[10px] font-bold uppercase tracking-wide ${value === '' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'}`}
      >None</button>
      {CATEGORY_PALETTE.map(c => (
        <button
          key={c.key}
          type="button"
          title={c.label}
          aria-label={c.label}
          aria-pressed={value === c.key}
          onClick={() => onChange(c.key)}
          className={`w-6 h-6 rounded-full ${c.dot} ${value === c.key ? 'ring-2 ring-offset-1 ring-slate-800' : 'hover:ring-2 hover:ring-offset-1 hover:ring-slate-300'}`}
        />
      ))}
    </div>
  );
}
