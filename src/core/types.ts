export type NoteType = "research" | "comparison" | "technical" | "journal" | "snippet";

export type RenderProfile = "hosted" | "standalone";

export interface Note {
  id: string;
  slug: string;
  path: string;
  title: string;
  type: NoteType;
  theme: string;
  theme_profile: RenderProfile;
  thread_id: string;
  is_final: boolean;
  /** When true, the note has a sidecar <slug>.entries.jsonl and viewer
   *  chrome streams entries via SSE. Flips to false on finalize. */
  live: boolean;
  /** ISO timestamp of the most recent append_entry, or null if no entries
   *  have been appended yet. Used by list_expiring to surface idle live
   *  notes (per ADR-019 surfacing logic). Stops updating at finalize. */
  last_entry_at: string | null;
  created: string;
  updated: string;
  expires_at: string | null;
  word_count: number;
  summary: string | null;
  body_html: string;
  tags: string[];
  /** Device that created the note. Null on rows that predate W2 migration
   *  with no backfill source (shouldn't happen — migration uses
   *  getOrCreateDeviceId()). Sync daemon uses this to skip own-echo on pull
   *  and to filter which notes to push. */
  origin_device_id: string | null;
  /** Device allowed to append_entry on this live note. Null for non-live
   *  notes. Append on a foreign-owner live note throws with a clear message
   *  pointing at the canonical workflow (create your own live note in the
   *  same thread). */
  owner_device_id: string | null;
  /** v0.17: when true, /raw/:uuid splices entries into body_html at render
   *  time and parent chrome postMessages new entries into the body iframe.
   *  Side panel is suppressed for these notes. Only meaningful when live=1.
   *  Default false (live notes keep using the side panel). */
  inline_render: boolean;
}

export interface NoteMeta {
  id: string;
  slug: string;
  path: string;
  title: string;
  type: NoteType;
  theme: string;
  theme_profile: RenderProfile;
  thread_id: string;
  is_final: boolean;
  live: boolean;
  last_entry_at: string | null;
  created: string;
  updated: string;
  expires_at: string | null;
  word_count: number;
  summary: string | null;
  tags: string[];
  origin_device_id: string | null;
  owner_device_id: string | null;
  inline_render: boolean;
}

export interface CreateNoteInput {
  type: NoteType;
  title: string;
  body_html: string;
  theme?: string;
  theme_profile?: RenderProfile;
  thread_id?: string;
  tags?: string[];
  is_final?: boolean;
  /** When true, the note is created as a live note: body_html is allowed
   *  to be empty/minimal chrome, and a sidecar <slug>.entries.jsonl is
   *  ready for append_entry calls. Default false. */
  live?: boolean;
  /** v0.17: when true (and live=true), entries render inline in body_html.
   *  Side panel suppressed. Body_html should contain a
   *  <section data-folio-live-feed></section> placeholder that entries
   *  splice into; if omitted, Folio auto-injects one at the end of body. */
  inline?: boolean;
}

/**
 * A single appended entry on a live note. Stored one-per-line in
 * threads/<topic>/<slug>.entries.jsonl. Tags carry all categorization;
 * Folio has only two rendering opinions on tags (state:* and view:pinned).
 */
export interface LiveEntry {
  /** Server-generated short uid (8-char base36). */
  id: string;
  /** ISO timestamp this entry was appended (server time). */
  ts: string;
  /** Optional ISO timestamp the entry's content actually happened. */
  occurred_at?: string;
  /** HTML content of the entry, after sanitize() on append. May be
   *  empty/whitespace for pure tag-mutation entries (used by set_pinned).
   *  Empty entries don't render in the feed but their tags still compile
   *  onto their refs targets. */
  content_html: string;
  /** Free-form tags. Namespaces use ":" delimiter (e.g. "state:done",
   *  "project:folio"). Folio does not validate tag values. */
  tags: string[];
  /** Optional entry ids this entry references. Used for chain-of-entries
   *  tag mutation: a follow-up entry's tags merge into the referenced
   *  entry's compiled tag set per the compile rule. */
  refs?: string[];
  /** Optional importance hint (1=highest, 5=lowest). Renderer may choose
   *  to surface; not used in compile logic. */
  importance?: 1 | 2 | 3 | 4 | 5;
  /** Optional external reference (URL, ticket id, etc.). */
  source_ref?: string;
}

/** Entry plus compiled state derived from chain-of-entries follow-ups. */
export interface CompiledEntry extends LiveEntry {
  /** Compiled tag set: this entry's tags merged with every follower's
   *  tags. Namespace `ns:*` follows last-write-wins; non-namespaced
   *  tags accumulate. */
  compiled_tags: string[];
  /** Compiled value of the `state:*` namespace, if any (e.g. "done",
   *  "cancelled", "snoozed", "open"). Renderer applies decoration. */
  state?: string;
  /** True iff compiled `view:*` value is exactly "pinned". */
  pinned: boolean;
  /** False iff content_html (trimmed) is empty — the entry won't be
   *  rendered in the feed, only its tag effects on refs targets apply. */
  rendered: boolean;
}

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  type: NoteType;
  thread_id: string;
  is_final: boolean;
  created: string;
  score: number;
  snippet: string;
  matched_columns: string;
}
