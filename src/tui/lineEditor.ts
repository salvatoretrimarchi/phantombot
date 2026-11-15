/**
 * The ONE editor behind every one-line value the TUI asks the user to type,
 * and behind the chat prompt's editing keys and typed text.
 *
 * Pure — no React, no Ink, no I/O: a key event and the field's state in, the
 * next state out. The state is `promptBox.ts`'s `PromptState` (text plus a
 * grapheme-index cursor), and every move and delete below is one of that
 * module's functions, so the chat box, the setup questions, the search boxes
 * and the confirmation gate cannot disagree about what a word is, where a line
 * ends, or what ^w removes.
 *
 * ## Why this exists
 *
 * Each screen used to carry its own `slice(0, -1)` and `text + char`. Typing
 * and Backspace worked, so nothing looked wrong until the first typo in the
 * MIDDLE of a long value — a base URL, an API key, a model id — which could
 * only be fixed by deleting everything after it, because there was no cursor
 * to move. Of the typed boxes only the chat box had one. A value is now
 * edited in exactly one way, and a screen that wants a text field takes this module's
 * behaviour whole instead of re-deriving a worse copy of it.
 *
 * ## The key map
 *
 * ←/→ and ^b/^f move one character; Alt or Ctrl with ←/→, and Alt-b/Alt-f,
 * move one word; Home/End and ^a/^e go to either end; Backspace deletes before
 * the cursor and Delete deletes under it; Alt-Backspace and Ctrl-Backspace
 * delete a word back, Alt-d, Alt-Delete and Ctrl-Delete a word forward; ^w
 * deletes back to the previous space, ^u back to the start, ^d the character
 * under the cursor.
 * `docs/reference/tui-keys.md` is the user-facing list; change them together.
 */

import {
  backspaceAtCursor,
  cursorEnd,
  cursorHome,
  cursorLeft,
  cursorLineEnd,
  cursorLineStart,
  cursorRight,
  cursorWordLeft,
  cursorWordRight,
  deleteAtCursor,
  deleteToLineStart,
  deleteWhitespaceWordLeft,
  deleteWordLeft,
  deleteWordRight,
  graphemes,
  insertAtCursor,
  promptState,
  type PromptState,
} from "./promptBox.ts";

/**
 * The part of Ink's `Key` that editing reads. A subset on purpose: Ink's own
 * `Key`, `useStableInput`'s narrower copy and a test's object literal are all
 * assignable to it.
 */
export interface EditKey {
  leftArrow?: boolean;
  rightArrow?: boolean;
  home?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface EditOptions {
  /**
   * Whether the Home/End KEYS move the cursor. On by default; a screen whose
   * Home/End already scroll something (the chat transcript, the log pane)
   * turns it off and keeps ^a/^e for the line ends.
   */
  homeEnd?: boolean;
  /**
   * The bytes of this key event, when the caller has them (`useRawKey`). It is
   * the only way to tell the Delete key from Backspace: Ink reports both
   * `0x7f` and `ESC[3~` as `key.delete`. Without it, `key.delete` is a
   * Backspace, which is what the key sends on essentially every terminal.
   */
  raw?: string;
}

/**
 * `ESC [ 3 ~`, with an optional modifier (`ESC [ 3 ; 5 ~`, kitty's
 * `ESC [ 3 ; 1 : 1 ~`) and the rxvt `$`/`^` spellings: the Delete KEY. A
 * second ESC in front is Alt spelled as an Esc prefix: Ink reports
 * `ESC ESC [ 3 ~` as `delete` with `meta`, the way it reports `ESC ESC [ D`
 * as `leftArrow` with `meta`. A Backspace is `0x7f`, `0x08` or kitty's
 * `ESC [ 127 u`, never this.
 */
const DELETE_KEY_SEQUENCE = /^\x1b\x1b?\[3(?:;\d+(?::\d+)?)?[~$^]$/;

export function isDeleteKeySequence(raw: string | undefined): boolean {
  return raw !== undefined && DELETE_KEY_SEQUENCE.test(raw);
}

export type DeleteKind = "backward" | "forward";

/**
 * Which way a Backspace/Delete key event deletes, or `undefined` when it is
 * neither. Exported because a multi-line buffer (`FileEditor`) has its own
 * state but must agree on which key is which.
 */
export function deleteKind(key: EditKey, raw?: string): DeleteKind | undefined {
  if (key.delete && isDeleteKeySequence(raw)) return "forward";
  if (key.backspace || key.delete) return "backward";
  return undefined;
}

/**
 * One key event applied to a field: the next state, or `undefined` when the key
 * is not an editing key (so the caller can treat it as text, or as its own).
 *
 * Order matters and is pinned by tests: modified keys sit ABOVE their plain
 * forms because Ink reports Alt-← as `leftArrow` with `meta`, and Alt-Backspace
 * as `delete` with `meta`; the plain branch would take either as one character.
 */
export function editKey(
  state: PromptState,
  char: string,
  key: EditKey,
  opts: EditOptions = {},
): PromptState | undefined {
  const modified = Boolean(key.ctrl || key.meta);
  // Alt-<letter> arrives as `meta` plus the letter. Ctrl-<letter> is handled
  // below on its own, so a ctrl chord never counts as Alt.
  const word = !key.ctrl && key.meta ? char.toLowerCase() : "";

  if ((modified && key.leftArrow) || word === "b") return cursorWordLeft(state);
  if ((modified && key.rightArrow) || word === "f") return cursorWordRight(state);
  if (word === "d") return deleteWordRight(state);

  const kind = deleteKind(key, opts.raw);
  if (kind !== undefined && modified) {
    return kind === "forward" ? deleteWordRight(state) : deleteWordLeft(state);
  }

  if (key.leftArrow || (key.ctrl && char === "b")) return cursorLeft(state);
  if (key.rightArrow || (key.ctrl && char === "f")) return cursorRight(state);
  if (opts.homeEnd !== false) {
    if (key.home) return cursorHome(state);
    if (key.end) return cursorEnd(state);
  }
  if (key.ctrl && char === "a") return cursorLineStart(state);
  if (key.ctrl && char === "e") return cursorLineEnd(state);
  if (key.ctrl && char === "w") return deleteWhitespaceWordLeft(state);
  if (key.ctrl && char === "u") return deleteToLineStart(state);
  if (key.ctrl && char === "d") return deleteAtCursor(state);

  if (kind === "forward") return deleteAtCursor(state);
  if (kind === "backward") return backspaceAtCursor(state);
  return undefined;
}

/**
 * Every C0 control, DEL and C1 control. None of them is a character a value
 * can hold, and the layout counts each as zero columns (`string-width`) while
 * the terminal does not — a tab jumps to the next tab stop, a stray ESC starts
 * an escape sequence — so a drawn row stops lining up with what was measured.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_SPLIT = /([\u0000-\u001f\u007f-\u009f])/;

/** A Backspace that a typed chunk carried, between its runs of text. */
export const BACKSPACE: unique symbol = Symbol("backspace");

/** One step of a typed chunk: a run of text to insert, or a Backspace. */
export type TypedStep = string | typeof BACKSPACE;

/**
 * The walk behind every typed chunk: the keystrokes a terminal batched into it
 * put back, in order. A DEL or BS byte is a `BACKSPACE` step, a tab becomes
 * `opts.tab`, a `"\n"` is kept only where `opts.newlines` says so, and every
 * other control character is dropped.
 *
 * The text between two Backspaces is ONE step, so a chunk costs one insert
 * per run however many lines it has. Inserting line by line re-reads the whole
 * field for each line: a 2,000-line paste (88 KB) took more than 10 s that
 * way, against less than 20 ms in one insert.
 */
function typedSteps(
  text: string,
  opts: { tab: string; newlines: boolean },
): TypedStep[] {
  const steps: TypedStep[] = [];
  let pending = "";
  for (const piece of text.split(CONTROL_SPLIT)) {
    if (piece === "") continue;
    if (piece.length !== 1 || !CONTROL.test(piece)) {
      pending += piece;
    } else if (piece === "\x7f" || piece === "\b") {
      if (pending !== "") steps.push(pending);
      steps.push(BACKSPACE);
      pending = "";
    } else if (piece === "\t") {
      pending += opts.tab;
    } else if (piece === "\n" && opts.newlines) {
      pending += "\n";
    }
  }
  if (pending !== "") steps.push(pending);
  return steps;
}

function applySteps(state: PromptState, steps: TypedStep[]): PromptState {
  return steps.reduce(
    (next, step) =>
      step === BACKSPACE ? backspaceAtCursor(next) : insertAtCursor(next, step),
    state,
  );
}

/**
 * Text arriving at the cursor of a one-line value. A read can carry several
 * keys at once — three Backspaces that land in one read are `"\x7f\x7f\x7f"`,
 * and Ink hands that over as ONE string of characters, not as three key
 * events — so DEL and BS are Backspaces here, a tab is one space, and every
 * other control character is dropped. Newlines are the caller's business: see
 * `applyTextChunkAt`, `typeLine` and `typeMultiline`.
 */
export function typeText(state: PromptState, text: string): PromptState {
  return applySteps(state, typedSteps(text, { tab: " ", newlines: false }));
}

/**
 * Text for a box that never submits from a chunk (a search, the log filter,
 * the name gate). A newline inside the text is whitespace. One that ENDS the
 * chunk is dropped: it is the end of the line that was copied, and as a
 * trailing space it would make a pasted name fail the name gate, which
 * compares exactly, with nothing on screen to show why.
 */
export function typeLine(state: PromptState, text: string): PromptState {
  return typeText(
    state,
    text.replace(/(?:\r\n|\r|\n)+$/, "").replace(/\r\n|\r|\n/g, " "),
  );
}

/**
 * The steps of a chunk typed into a box that keeps its lines (the chat prompt,
 * and the identity file editor through `editorType` in `editorBuffer.ts`):
 * each newline (`\r\n`, `\r` or `\n`) stays, as one `"\n"`, and a tab is two
 * spaces. In a value on one line a tab is a stray separator, in pasted lines
 * it is indentation.
 */
export function multilineSteps(text: string): TypedStep[] {
  return typedSteps(text.replace(/\r\n?/g, "\n"), { tab: "  ", newlines: true });
}

/**
 * Text for the chat prompt: typed like `typeText`, except that it keeps its
 * lines (`multilineSteps`). Whether a chunk is a paste, a dropped image or a
 * batched Enter is the chat screen's call (`Chat.tsx`); this is only how its
 * text goes in.
 */
export function typeMultiline(state: PromptState, text: string): PromptState {
  return applySteps(state, multilineSteps(text));
}

/** Every control character but a tab. */
const KEY_IN_TEXT = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/;

/**
 * Whether a chunk carries keys as well as text: any control character but a
 * tab. Enter, Backspace and the Ctrl chords are sent as control characters,
 * so one inside a chunk is a key that landed in the same read as the text
 * around it, or a stray byte in a paste. A tab is left out because it is whitespace that
 * text can carry: `imageDrop.ts` accepts one between dropped paths.
 */
export function carriesKeys(text: string): boolean {
  return KEY_IN_TEXT.test(text);
}

export interface TextChunkAtResult {
  /** What the field holds afterwards, cursor included. */
  state: PromptState;
  /** Present when the chunk contained a newline: the value to submit. */
  submit?: string;
}

/**
 * One chunk of typed text applied at the cursor of a field that SUBMITS.
 *
 * Ink reports `key.return` only for a chunk that is exactly `"\r"`. A chunk can
 * carry a newline inside it — a paste, or keystrokes the terminal batched
 * under load — and then the newline is not a character, it is Enter: the text
 * before the FIRST newline completes the value at the cursor and submits it.
 * Whatever follows is typed into the box that is left, like any other text
 * (`typeLine`: its Backspaces delete, its control characters do not go in, a
 * further newline is a space). Handled naively, `"alice\r"` becomes a persona
 * literally named `"alice\n"`.
 */
export function applyTextChunkAt(
  state: PromptState,
  chunk: string,
): TextChunkAtResult {
  const newline = /\r\n|\r|\n/.exec(chunk);
  if (!newline) return { state: typeText(state, chunk) };
  const head = chunk.slice(0, newline.index);
  const tail = chunk.slice(newline.index + newline[0].length);
  const rest = typeLine(promptState(""), tail).text.trim();
  const submit = typeText(state, head).text.trim();
  return submit
    ? { state: promptState(rest), submit }
    : { state: promptState(rest) };
}

/** The first `max` characters of the field, the cursor kept inside them. */
export function limitLength(state: PromptState, max: number): PromptState {
  const gs = graphemes(state.text);
  if (gs.length <= max) return state;
  return { text: gs.slice(0, max).join(""), cursor: Math.min(state.cursor, max) };
}

/** The mask glyph for a secret: one per character, so the length stays honest. */
export const MASK = "•";

/** A field split around its cursor, ready to draw. */
export interface FieldParts {
  before: string;
  /** The cell under the cursor — the character there, or a blank past the end. */
  at: string;
  after: string;
  /** The cursor sits past the last character. */
  atEnd: boolean;
}

/**
 * The text of a field around its cursor.
 *
 * The cursor is drawn ON a cell, never as a glyph inserted into the text
 * (issue #677), so moving it inside the text changes nothing about how the
 * text wraps. Past the end it takes one blank cell; on a line that is exactly
 * full that cell starts a new row. A masked field shows one dot per character
 * and the cursor sits on a dot, so a secret is never drawn.
 */
export function fieldParts(
  state: PromptState,
  opts: { masked?: boolean } = {},
): FieldParts {
  const gs = graphemes(state.text);
  const shown = opts.masked ? gs.map(() => MASK) : gs;
  const at = Math.max(0, Math.min(state.cursor, shown.length));
  const cell = shown[at];
  return {
    before: shown.slice(0, at).join(""),
    at: cell === undefined || /^\s+$/.test(cell) ? " " : cell,
    after: shown.slice(at + 1).join(""),
    atEnd: at >= shown.length,
  };
}
