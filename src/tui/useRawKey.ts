/**
 * The bytes behind the key Ink is reporting.
 *
 * Ink hands a handler `(input, key)` and nothing else, and it cannot tell the
 * Backspace key from the Delete key: `0x7f` and `ESC[3~` are both `key.delete`
 * with an empty `input`. That is why the chat box once treated Delete as a
 * Backspace, and why the identity editor deleted FORWARD on Backspace. The one
 * thing that does tell them apart is the sequence the terminal sent, and Ink
 * already emits it — as the `input` event on `internal_eventEmitter`, which
 * `useStdin()` exposes — just before it calls the `useInput` handlers.
 *
 * `useRawKey()` listens on that emitter and keeps the latest sequence in a ref.
 * The ref is read inside a key handler, which Ink calls synchronously from the
 * same `emit`, so the sequence in it is the one that produced the key.
 *
 * ## It must be called BEFORE the `useInput` it serves
 *
 * Listeners run in the order they were added, and React runs a component's
 * effects in the order its hooks were called. Calling this first registers its
 * listener first, so the ref is already written when the handler runs.
 * `useStableInput` does that for every screen that uses it; a component with its
 * own `useInput` (the chat screen) calls this directly above it. Pinned by
 * `tests/tui-raw-key.test.tsx`, which also fails loudly if Ink ever stops
 * emitting the event.
 *
 * Without the event (a context with no emitter) the ref stays empty and
 * `editKey` falls back to the old rule: `key.delete` is a Backspace.
 */

import { useEffect, useRef } from "react";
import { useStdin } from "ink";

export function useRawKey(): { readonly current: string } {
  const { internal_eventEmitter: emitter } = useStdin();
  const raw = useRef("");
  useEffect(() => {
    if (!emitter) return;
    const record = (data: unknown) => {
      raw.current = typeof data === "string" ? data : String(data);
    };
    emitter.on("input", record);
    return () => {
      emitter.off("input", record);
    };
  }, [emitter]);
  return raw;
}
