import { SEASON_PRESETS, RoleSeason } from '../lib/roleMaster';

// Colored season tag (🟢 Summer / 🔵 Winter) shared by the Duties chart,
// the Directory, and the duty editor.
export default function SeasonChip({ season }: { season: RoleSeason }) {
  const p = SEASON_PRESETS[season];
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${p.chip}`}>
      {p.emoji} {p.label}
    </span>
  );
}
