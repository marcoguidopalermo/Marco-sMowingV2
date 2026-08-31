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
// API: PlaceAutocompleteElement (Places API "New"), falling back to the legacy
// google.maps.places.Autocomplete widget.
//
// The fallback is not belt-and-braces, it is the migration path. This Cloud
// project was created 2026-03-10, after Google's 1 March 2025 cutoff, which
// makes it a "NEW CUSTOMER": the legacy widget is REFUSED for us, not merely
// deprecated. It constructs without throwing and then never returns a
// prediction, which is exactly the silent failure that was showing up as a
// deprecation warning and nothing else.
//
// PlaceAutocompleteElement needs places.googleapis.com — "Places API (New)" —
// enabled on the project. Until it is, this falls back to the legacy widget and
// simply offers no suggestions; typing still works and the resolver still runs.
import { useEffect, useRef } from 'react';
import { loadGoogleMaps, DEFAULT_MAP_CENTER } from '../lib/googleMaps';
import { serviceAreaBounds, serviceAreaBias } from '../lib/resolveAddressPoint';

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
  const paeRef = useRef<any>(null);

  useEffect(() => {
    let dead = false;
    let listener: any = null;
    (async () => {
      try {
        const { maps, hasPlaces } = await loadGoogleMaps();
        // Places unavailable is not an error here: the field stays a plain
        // text input and the resolver still handles what gets typed.
        if (dead || !hasPlaces || !el.current) return;
        // NEW Places first.
        const lib: any = await maps.importLibrary?.('places');
        const PAE = lib?.PlaceAutocompleteElement || maps.places?.PlaceAutocompleteElement;
        if (PAE && el.current.parentElement) {
          const host = el.current.parentElement;
          const pae: any = new PAE({
            locationBias: serviceAreaBias(maps, DEFAULT_MAP_CENTER),
            includedRegionCodes: ['ca'],
          });
          // The element replaces the plain input in place, inheriting its box.
          pae.className = el.current.className;
          if (placeholder) pae.setAttribute('placeholder', placeholder);
          el.current.style.display = 'none';
          host.insertBefore(pae, el.current);
          paeRef.current = pae;
          pae.addEventListener('gmp-select', async (ev: any) => {
            try {
              const pr = ev?.placePrediction;
              if (!pr) return;
              const place = pr.toPlace();
              await place.fetchFields({ fields: ['location', 'formattedAddress'] });
              const loc = place.location;
              if (!loc) return;
              pickRef.current({
                address: place.formattedAddress || '',
                lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
                lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
              });
            } catch (err) { console.warn('[maps] place selection failed:', err); }
          });
          return;
        }
        // LEGACY fallback — refused on new-customer projects, harmless there.
        if (!maps.places?.Autocomplete) return;
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
      try { paeRef.current?.remove?.(); } catch { /* noop */ }
      paeRef.current = null;
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
