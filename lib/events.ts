/**
 * Corporate-action events that change the shape of a portfolio after the
 * Feb 5, 2026 inception date.
 *
 * Right now this is empty. When a spin-off lands (Honeywell is rumored), add
 * an entry here and run `npm run fetch-prices -- --full`. The portfolio
 * engine will pick up the new position automatically:
 *
 *   - On `effectiveDate`, the parent's shareholders get
 *     `parent_shares * sharesPerParentShare` shares of `childTicker`,
 *     priced at the child's first close on or after `effectiveDate`.
 *   - From that day forward the child contributes its own value to the
 *     parent's owner's portfolio total.
 *
 * The child ticker MUST also be added to `picks.ts -> TICKER_NAMES` and
 * fetched (the fetch script will pull it via `lib/events.getSpinoffTickers`).
 */
export interface SpinoffEvent {
  parentTicker: string;
  childTicker: string;
  childName: string;
  effectiveDate: string;
  sharesPerParentShare: number;
}

export const SPINOFFS: SpinoffEvent[] = [
  // Example for when HON's spin-off lands (numbers are placeholders):
  // {
  //   parentTicker: "HON",
  //   childTicker: "HONA",            // change to the real ticker
  //   childName: "Honeywell Aerospace",
  //   effectiveDate: "2026-MM-DD",    // first trading day of child
  //   sharesPerParentShare: 0.25,     // distribution ratio
  // },
];

export function getSpinoffTickers(): string[] {
  return SPINOFFS.map((s) => s.childTicker);
}

export function spinoffsForParent(parent: string): SpinoffEvent[] {
  return SPINOFFS.filter((s) => s.parentTicker === parent);
}
