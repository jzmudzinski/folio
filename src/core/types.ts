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
  created: string;
  updated: string;
  expires_at: string | null;
  word_count: number;
  summary: string | null;
  body_html: string;
  tags: string[];
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
  created: string;
  updated: string;
  expires_at: string | null;
  word_count: number;
  summary: string | null;
  tags: string[];
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
