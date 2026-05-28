export type ReaderTheme    = "night" | "parchment" | "paper";
export type ReaderFontSize = 1 | 2 | 3 | 4 | 5;
export type ReaderLineHeight = 1 | 2 | 3;
export type ReaderFontFamily = "serif" | "sans";

export type ReaderPosition = {
  chapterIndex:      number;
  scrollPercentage:  number;
  lastReadAt:        string;
};

export type ReaderBookmark = {
  id:            string;
  chapterIndex:  number;
  paragraphText: string; // first 120 chars
  addedAt:       string;
};

export type ReaderSettings = {
  theme:      ReaderTheme;
  fontSize:   ReaderFontSize;
  lineHeight: ReaderLineHeight;
  fontFamily: ReaderFontFamily;
};

// ── Key builders ─────────────────────────────────────────────────────────────

const POS_KEY      = (slug: string) => `nexus_reader_pos_${slug}`;
const BM_KEY       = (slug: string) => `nexus_reader_bm_${slug}`;
const SETTINGS_KEY = "nexus_reader_settings";

// ── Reading position ──────────────────────────────────────────────────────────

export function getReadingPosition(slug: string): ReaderPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(POS_KEY(slug));
    return raw ? (JSON.parse(raw) as ReaderPosition) : null;
  } catch { return null; }
}

export function saveReadingPosition(
  slug: string,
  pos: Omit<ReaderPosition, "lastReadAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      POS_KEY(slug),
      JSON.stringify({ ...pos, lastReadAt: new Date().toISOString() }),
    );
  } catch { /* quota exceeded — ignore */ }
}

// ── Bookmarks ─────────────────────────────────────────────────────────────────

export function getBookmarks(slug: string): ReaderBookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BM_KEY(slug));
    return raw ? (JSON.parse(raw) as ReaderBookmark[]) : [];
  } catch { return []; }
}

export function addBookmark(
  slug: string,
  bm: Omit<ReaderBookmark, "id" | "addedAt">,
): void {
  if (typeof window === "undefined") return;
  const bookmarks = getBookmarks(slug);
  bookmarks.unshift({
    ...bm,
    id:      `bm-${Date.now()}`,
    addedAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(BM_KEY(slug), JSON.stringify(bookmarks.slice(0, 50)));
  } catch { /* ignore */ }
}

export function removeBookmark(slug: string, id: string): void {
  if (typeof window === "undefined") return;
  const filtered = getBookmarks(slug).filter((b) => b.id !== id);
  try {
    localStorage.setItem(BM_KEY(slug), JSON.stringify(filtered));
  } catch { /* ignore */ }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: ReaderSettings = {
  theme:      "night",
  fontSize:   3,
  lineHeight: 2,
  fontFamily: "serif",
};

export function getReaderSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ReaderSettings>) };
  } catch { return DEFAULT_SETTINGS; }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}
