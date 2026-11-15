/**
 * A typed value as React state, and the one way a key reaches it.
 *
 * A field's live value is read from a REF, never from the render closure:
 * several stdin chunks can arrive before React commits, and a closure-read
 * value is one render stale — the bug that once named a persona after only its
 * last few letters (invariant 35). `useTextField` keeps the ref and the
 * state in step, so a handler reads `field.ref.current` and a render draws
 * `field.state`.
 *
 * `feedField` is the whole of a text field's key handling: the editing keys
 * (`editKey`), then typed text (`applyTextChunkAt`). A screen calls it AFTER
 * the keys that are its own (Enter, Esc, ↑↓) and does nothing else with text.
 */

import { useCallback, useRef, useState } from "react";

import {
  applyTextChunkAt,
  editKey,
  limitLength,
  typeLine,
  type EditKey,
  type EditOptions,
} from "./lineEditor.ts";
import { promptState, type PromptState } from "./promptBox.ts";

export interface TextField {
  /** For drawing. */
  state: PromptState;
  /** For key handlers: always the latest value, even between renders. */
  ref: { readonly current: PromptState };
  set: (next: PromptState) => void;
}

export function useTextField(initial = ""): TextField {
  const [state, setState] = useState<PromptState>(() => promptState(initial));
  const ref = useRef(state);
  const set = useCallback((next: PromptState) => {
    ref.current = next;
    setState(next);
  }, []);
  return { state, ref, set };
}

export interface FieldInputOptions extends EditOptions {
  /**
   * What a newline inside a chunk means. `"submit"` (the default) is Enter: the
   * text before it is returned as `submit`. `"space"` is for a box that must
   * never submit from a chunk (the searches, the log filter, the name gate):
   * a pasted newline is whitespace there, and one at the end of the paste is
   * dropped (`typeLine`).
   */
  newline?: "submit" | "space";
  /** The most characters the field may hold; the excess is cut off the end. */
  max?: number;
}

export interface FieldInputResult {
  /** The key was an edit or typed text. `false`: it is the screen's own. */
  handled: boolean;
  /** Text was inserted (as opposed to a move or a delete). */
  typed?: boolean;
  /** A newline inside the chunk asked to submit this value. */
  submit?: string;
}

/** Whatever `key` an Ink handler is given: the editing flags plus the screen's own. */
export type FieldKey = EditKey & { return?: boolean; escape?: boolean; tab?: boolean };

export function feedField(
  field: Pick<TextField, "ref" | "set">,
  char: string,
  key: FieldKey,
  opts: FieldInputOptions = {},
): FieldInputResult {
  // Enter, Esc and Tab belong to the screen. A bare "\r" never reaches here as
  // text (Ink reports it as `return`); one inside a chunk is handled below.
  if (key.return || key.escape || key.tab) return { handled: false };
  const cap = (next: PromptState) =>
    opts.max === undefined ? next : limitLength(next, opts.max);

  const edited = editKey(field.ref.current, char, key, opts);
  if (edited) {
    field.set(edited);
    return { handled: true };
  }
  if (!char || key.ctrl || key.meta) return { handled: false };

  if (opts.newline === "space") {
    const before = field.ref.current;
    const next = cap(typeLine(before, char));
    // A chunk that leaves nothing behind (a lone "\n", which is not Enter
    // here) typed nothing.
    if (next === before) return { handled: true };
    field.set(next);
    return { handled: true, typed: true };
  }
  const applied = applyTextChunkAt(field.ref.current, char);
  field.set(cap(applied.state));
  return applied.submit === undefined
    ? { handled: true, typed: true }
    : { handled: true, typed: true, submit: applied.submit };
}
