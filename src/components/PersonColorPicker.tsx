import { CATEGORY_PALETTE } from '../lib/roleCategories';

// A single row of palette swatches for a person's IDENTITY colour. Reuses the
// house CATEGORY_PALETTE (amber/red deliberately excluded there, since those
// read as urgency). Unlike the old task-colour picker there is no "None" —
// every person always carries a colour (auto-assigned on creation, editable
// here). `value` is a palette key.
interface PersonColorPickerProps {
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}

export default function PersonColorPicker({ value, onChange, disabled }: PersonColorPickerProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {CATEGORY_PALETTE.map(c => (
        <button
          key={c.key}
          type="button"
          title={c.label}
          aria-label={c.label}
          aria-pressed={value === c.key}
          disabled={disabled}
          onClick={() => onChange(c.key)}
          className={`w-6 h-6 rounded-full ${c.dot} disabled:opacity-40 disabled:cursor-not-allowed ${value === c.key ? 'ring-2 ring-offset-1 ring-slate-800' : 'enabled:hover:ring-2 enabled:hover:ring-offset-1 enabled:hover:ring-slate-300'}`}
        />
      ))}
    </div>
  );
}
