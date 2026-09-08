'use client';

import * as React from 'react';

/**
 * Track a CSS media query from JavaScript.
 *
 * Needed because a Tailwind responsive class cannot hide a portal: `Modal`
 * renders into `document.body`, so wrapping it in `xl:hidden` leaves the
 * wrapper behind and the dialog on screen at every width. Anything that
 * *renders* one layout or another -- rather than styling both -- has to ask the
 * viewport directly.
 *
 * Returns `false` on the server and on the first client render, so the markup
 * matches between the two and hydration stays quiet. A component that must not
 * flash the wrong layout should treat `false` as "not yet known" and render the
 * wide variant, which is the one the desktop app is for.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Below Tailwind's `xl`, where a 380px side panel would leave no canvas. */
export function useBelowXl(): boolean {
  return useMediaQuery('(max-width: 1279px)');
}

/**
 * Below Tailwind's `md`: a phone.
 *
 * The editor does not claim to work here. Dragging nodes and wiring edges with
 * a thumb on a 390px canvas is not a thing this product does well, and
 * pretending otherwise means people discover it by losing work. Below `md` the
 * canvas is read-only and says so; viewing a workflow and running it both stay.
 */
export function useBelowMd(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
