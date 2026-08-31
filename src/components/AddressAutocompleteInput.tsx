// ADDRESS ENTRY WITH GOOGLE SUGGESTIONS — one input, used by every quote form.
//
// Suggestions used to exist only inside the measuring tool's own search box, so
// the address on the quote was free text that had to be RESOLVED later, and
// that resolution is the thing that can fail (see lib/resolveAddressPoint and
// the amber banner it feeds).
//
// Picking a suggestion here hands back the coordinates Google already returned,
// so the map opens on them directly. There is no second lookup, and therefore
// nothing for that failure class to happen to. Typing free text still works —
// it just falls back to the resolver, banner and all.
//
// API: this is google.maps.places.Autocomplete, part of the Places API that is
// already enabled and already serving the measuring tool's search box. No new
// API to switch on and no change to the key's restrictions.
import { useEffect, useRef } from 'react';
import { loadGoogleMaps, DEFAULT_MAP_CENTER } from '../lib/googleMaps';
import { serviceAreaBounds } from '../lib/resolveAddressPoint';

export interface PickedAddress {
  address: string;
  lat: number;
  lng: number;
}

export default function AddressAutocompleteInput({
  value, onChange, onPick, placeholder, className, disabled, inputRef,
}: {
  value: string;
  /** Free typing. The caller decides what that invalidates. */
  onChange: (text: string) => void;
  /** A suggestion was chosen — carries the coordinates, so no second lookup. */
  onPick: (picked: PickedAddress) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  const ownRef = useRef<HTMLInputElement>(null);
  const el = inputRef || ownRef;
  // Keep the latest callback without re-binding the widget on every render.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    let dead = false;
    let listener: any = null;
    (async () => {
      try {
        const { maps, hasPlaces } = await loadGoogleMaps();
        // Places unavailable is not an error here: the field stays a plain
        // text input and the resolver still handles what gets typed.
        if (dead || !hasPlaces || !el.current || !maps.places?.Autocomplete) return;
        const ac = new maps.places.Autocomplete(el.current, {
          fields: ['geometry', 'formatted_address', 'name'],
          // Same service area as resolveAddressPoint, derived from the same
          // centre and radius — see serviceAreaBounds.
          bounds: serviceAreaBounds(maps, DEFAULT_MAP_CENTER) || undefined,
          componentRestrictions: { country: 'ca' },
        });
        listener = maps.event.addListener(ac, 'place_changed', () => {
          const place = ac.getPlace();
          const loc = place?.geometry?.location;
          if (!loc) return;                    // typed text, not a suggestion
          const text = place.formatted_address || place.name || '';
          pickRef.current({
            address: text,
            lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
            lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
          });
        });
      } catch (err) {
        console.warn('[maps] address autocomplete unavailable — plain text entry still works:', err);
      }
    })();
    return () => {
      dead = true;
      try { if (listener) (window as any).google?.maps?.event?.removeListener(listener); } catch { /* noop */ }
    };
  }, [el]);

  return (
    <input
      ref={el}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      // The widget writes the chosen address into the input itself; onChange
      // keeps React's value in step for both typing and selection.
      onChange={e => onChange(e.target.value)}
      className={className}
      autoComplete="off"
    />
  );
}
