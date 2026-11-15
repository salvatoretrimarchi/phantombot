/**
 * Ink-resilient `useInput`.
 *
 * Ink's `useInput` re-subscribes its listener whenever the handler closure
 * changes — which is EVERY render, since screens define their handler inline.
 * A keystroke arriving between the unsubscribe and the resubscribe (the
 * cleanup/reattach window of one React commit) is silently dropped: the
 * user's Enter lands in a render tick and vanishes. This bit the wizard —
 * the first Enter on a freshly-mounted question screen could be eaten by the
 * App re-render that mounted it.
 *
 * The fix is to give Ink a STABLE handler: one closure, created once, that
 * forwards to the latest handler through a ref written on every render. Ink
 * then subscribes exactly once per mount and never drops a key to churn.
 *
 * The handler also gets the bytes of the key as a third argument (`useRawKey`):
 * the one thing Ink's `key` cannot say is whether `key.delete` was the Delete
 * key or Backspace.
 */

import { useRef } from "react";

import { useInput } from "ink";

import { useRawKey } from "./useRawKey.ts";

type Handler = (
  input: string,
  key: {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    home: boolean;
    end: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  },
  /** The sequence the terminal sent for this key; "" when it cannot be known. */
  raw: string,
) => void;

export function useStableInput(
  handler: Handler,
  options?: { isActive?: boolean },
): void {
  // First, so its listener is registered before `useInput`'s (see useRawKey).
  const raw = useRawKey();
  const ref = useRef(handler);
  ref.current = handler;
  // Created once — this is the closure Ink actually subscribes with.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useRef<(input: string, key: Parameters<Handler>[1]) => void>(
    (input, key) => ref.current(input, key, raw.current),
  ).current;
  useInput(stable, options ? { isActive: options.isActive } : undefined);
}
