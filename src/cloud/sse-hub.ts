/**
 * Cloud-side in-memory pub/sub for live note SSE streams.
 *
 * Simpler than src/core/sse-hub.ts because the cloud never reads
 * .entries.jsonl from disk — every entry it knows about arrived via a
 * push from a paired device. handlePush.live_entries calls publish()
 * after INSERTing the row, and any /v1/sync/live-stream subscribers
 * for that note's uuid get an SSE frame fanned out immediately.
 *
 * No fs.watch, no offset tracking. Channels are pure in-memory and
 * disappear when the process restarts — subscribers reconnect and the
 * server replays nothing (they're expected to fetch the current state
 * via /raw/<uuid> on reconnect; SSE is just for "what's new since I
 * connected").
 */

import type { ServerWebSocket } from "bun";

export interface LiveEntryFrame {
  id: string;
  note_uuid: string;
  ts: string;
  content_html: string;
  tags: string[];
  occurred_at: string | null;
  refs: string[];
  importance: number | null;
  source_ref: string | null;
}

export type Subscriber = (frame: LiveEntryFrame) => void;

interface Channel {
  subscribers: Set<Subscriber>;
}

const channels = new Map<string, Channel>();

function channel(noteUuid: string): Channel {
  let ch = channels.get(noteUuid);
  if (!ch) {
    ch = { subscribers: new Set() };
    channels.set(noteUuid, ch);
  }
  return ch;
}

/**
 * Register a subscriber on a note's channel. Returns an unsubscribe fn
 * the caller invokes when the SSE connection closes.
 */
export function subscribe(noteUuid: string, fn: Subscriber): () => void {
  const ch = channel(noteUuid);
  ch.subscribers.add(fn);
  return () => {
    ch.subscribers.delete(fn);
    // Drop empty channels so the Map doesn't grow unbounded on heavily
    // browsed notes.
    if (ch.subscribers.size === 0) channels.delete(noteUuid);
  };
}

/** Fan out a freshly received entry to every subscriber on that note. */
export function publish(noteUuid: string, frame: LiveEntryFrame): void {
  const ch = channels.get(noteUuid);
  if (!ch) return;
  for (const fn of ch.subscribers) {
    try {
      fn(frame);
    } catch {
      // A subscriber that throws shouldn't poison the broadcast for others.
    }
  }
}

/** Test helper: how many active channels are we tracking? */
export function _channelCount(): number {
  return channels.size;
}

// Bun WebSocket import surfaced for tests that want strict typing;
// not used here (SSE is HTTP/1.1, not WebSocket). Keep the import so
// future WebSocket variant compiles cleanly without re-adding.
void {} as ServerWebSocket | null;
