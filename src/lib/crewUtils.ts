// Stable cross-day crew identity used for matching the SAME logical crew
// across different days. Crew rows in appData.schedules carry an `id` that
// is freshly generated each time a crew is created (`crew-<timestamp>-<rand>`),
// so two days of "Lawn Crew #1" have different `id`s. CompletionEntry rows
// in the multi-day-job ledger need to compare crews across days for the
// auto-credit + priorPct calculations — this key is the stable basis.
//
// Format: "<division-lowercased>-<crewNumber>" — e.g. "lawn division-1".
// Division is lowercased + trimmed so accidental whitespace / casing
// inconsistencies don't break the match.
export function stableCrewKey(crew: { division: string; crewNumber: number }): string {
  return `${(crew.division || '').trim().toLowerCase()}-${crew.crewNumber}`;
}
