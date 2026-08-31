// A GOOGLE MAP MEASURES ITS CONTAINER ONCE, WHEN IT IS CREATED.
//
// If the div has no dimensions at that moment the map renders no tiles, and
// nothing later tells it to try again — you get a blank panel that stays blank.
// Any subsequent resize fixes it, which is why leaving to Street View and
// coming back "repaired" it: the second mount happened against a laid-out
// modal.
//
// The measuring tool's map box was `flex-1 min-h-0` — `min-h-0` is the
// flexbox idiom that lets a flex child shrink, and it also permits a computed
// height of exactly zero before layout settles. StreetViewPanel's equivalent
// box carries `min-h-[380px]` and has never shown the fault. That asymmetry is
// the whole bug.
//
// Two defences, because either alone can be defeated: give the container a
// real minimum height, and refuse to construct the map until it actually
// measures.

/** Does this element currently occupy space? */
export function hasSize(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  return el.offsetWidth > 0 && el.offsetHeight > 0;
}

/**
 * Resolve once the element has non-zero size. Resolves false on timeout rather
 * than hanging — the caller then builds the map anyway and leans on the
 * ResizeObserver, which is strictly better than never showing a map at all.
 * @param {HTMLElement|null} el The container.
 * @param {number} timeoutMs Give up after this long.
 * @return {Promise<boolean>} Whether it had size before the deadline.
 */
export function waitForSize(
  el: HTMLElement | null, timeoutMs = 3000,
): Promise<boolean> {
  if (hasSize(el)) return Promise.resolve(true);
  if (!el || typeof ResizeObserver === 'undefined') {
    return new Promise((r) => setTimeout(() => r(hasSize(el)), 50));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { ro.disconnect(); } catch { /* noop */ }
      clearTimeout(timer);
      resolve(ok);
    };
    const ro = new ResizeObserver(() => { if (hasSize(el)) finish(true); });
    ro.observe(el);
    const timer = setTimeout(() => finish(hasSize(el)), timeoutMs);
    // A frame is usually all it takes; observers do not fire for an element
    // that is already the size it will stay.
    requestAnimationFrame(() => { if (hasSize(el)) finish(true); });
  });
}
