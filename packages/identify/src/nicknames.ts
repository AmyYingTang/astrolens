/**
 * Curated common-name overlay — popular amateur nicknames that exist in no
 * structured source we query (verified absent from SIMBAD `NAME`, Wikidata
 * labels/aliases, Wikipedia, and OpenNGC's Common-names column). They live only
 * in observing apps (SkySafari / Telescopius) and the astrophotography
 * community, so the only reliable way to surface them is this hand-maintained
 * map. Keyed by a catalogue designation; extend it as new targets come up.
 */

export interface Nickname {
  en: string;
  zh?: string;
}

export const NICKNAMES: Record<string, Nickname> = {
  'NGC 3576': { en: 'Statue of Liberty Nebula', zh: '自由女神星云' },
  // Famous dark nebula with no catalogued common name — only survey designations
  // (Dobashi TGU). Keyed on its main one so it surfaces + gets named.
  'TGU H1868': { en: 'Dark Doodad', zh: '暗黑涂鸦' },
  // η Carinae — the iconic central engine of the Carina Nebula. Wildly variable
  // (V≈6.5 now), so it's beyond the bright-star cutoff and never fetched/kept
  // without curation. Keyed on the SIMBAD main_id.
  '* eta Car': { en: 'Eta Carinae', zh: '海山二' },
};

/** Normalise a designation for matching: collapse whitespace, upper-case. */
function norm(d: string): string {
  return d.replace(/\s+/g, ' ').trim().toUpperCase();
}

const INDEX: Record<string, Nickname> = Object.fromEntries(
  Object.entries(NICKNAMES).map(([k, v]) => [norm(k), v]),
);

/** First curated nickname matching any of the object's designations, if any. */
export function lookupNickname(designations: string[]): Nickname | undefined {
  for (const d of designations) {
    const n = INDEX[norm(d)];
    if (n) return n;
  }
  return undefined;
}
