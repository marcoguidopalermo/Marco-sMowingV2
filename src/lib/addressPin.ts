// THE ADDRESS PIN — which property this quote is for.
//
// On satellite imagery houses look alike and lot boundaries are not obvious,
// so a map centred on the right place is still ambiguous. The pin removes that.
//
// It marks a RESOLVED address and nothing else. An address that would not
// resolve gets the amber banner and a bare map — a pin dropped at a guess would
// be indistinguishable from a pin dropped at the answer, which is the failure
// the banner exists to prevent.

// Deliberately not one of the palette colours: on satellite imagery a pin in
// the drawing colours reads as part of the measurement. Amber holds up against
// grass, roofs and asphalt alike.
export const PIN_HEX = '#d97706';

/** Longest label that sits under a pin without sprawling across the roof. */
export const PIN_LABEL_MAX = 28;

export interface PinLabel {
  text: string;
  color: string;
  fontSize: string;
  fontWeight: string;
  className: string;
}

/**
 * The label to draw under the pin: the street line only, which is what
 * identifies the property on a screenshot. Undefined when there is nothing
 * worth drawing — a pin with an empty label box looks broken.
 * @param {string|null|undefined} address The full address.
 * @return {PinLabel|undefined} The Marker label, or undefined.
 */
export function pinLabel(address?: string | null): PinLabel | undefined {
  const first = String(address || '').split(',')[0].trim();
  if (!first) return undefined;
  const text = first.length > PIN_LABEL_MAX
    ? `${first.slice(0, PIN_LABEL_MAX - 1)}…`
    : first;
  return {
    text,
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: '800',
    // The outline lives in a stylesheet — white text on pale roofs and
    // concrete is unreadable without one.
    className: 'sm-pin-label',
  };
}
