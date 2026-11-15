/**
 * The line editor behind every typed value in the TUI (`lineEditor.ts`).
 *
 * Three layers, because a key map is easy to get plausibly wrong:
 *
 *  1. **The table** — each key, once, with the exact text and cursor it must
 *     leave. This is the documented key map (`docs/reference/tui-keys.md`).
 *  2. **The oracle** — eight seeded random sequences of 500 steps, each step a
 *     key through `editKey` or a typed chunk through `typeText`, replayed
 *     through a deliberately naive string-based reference written separately
 *     here as well. The two must agree on every single step, so a boundary
 *     (cursor at 0, at the end, on an empty field) cannot hide.
 *  3. **The invariants** — over text with emoji, CJK and combining marks, the
 *     cursor is always on a character boundary inside the text, and the cursor
 *     cell plus its neighbours always spell the field back.
 */

import { describe, expect, test } from "bun:test";

import {
  applyTextChunkAt,
  BACKSPACE,
  carriesKeys,
  deleteKind,
  editKey,
  fieldParts,
  isDeleteKeySequence,
  limitLength,
  multilineSteps,
  typeLine,
  typeMultiline,
  typeText,
  type EditKey,
} from "../src/tui/lineEditor.ts";
import { graphemes, promptState, type PromptState } from "../src/tui/promptBox.ts";

const ESC = "\x1b";
/** A field with the cursor at `at` (default: the end). */
const field = (text: string, at?: number): PromptState => ({
  text,
  cursor: at ?? graphemes(text).length,
});
/** `text|cursor` — how a state reads in a failure message. */
const show = (s: PromptState | undefined): string | undefined => {
  if (!s) return undefined;
  const gs = graphemes(s.text);
  return `${gs.slice(0, s.cursor).join("")}|${gs.slice(s.cursor).join("")}`;
};
/** Apply one key to the state written as "ab|cd" and read the result the same way. */
function press(
  at: string,
  char: string,
  key: EditKey,
  opts?: Parameters<typeof editKey>[3],
): string | undefined {
  const [before = "", after = ""] = at.split("|");
  return show(editKey(field(before + after, graphemes(before).length), char, key, opts));
}

describe("editKey: the documented key map", () => {
  test("←/→ and ^b/^f move one character, and stop at the ends", () => {
    expect(press("ab|cd", "", { leftArrow: true })).toBe("a|bcd");
    expect(press("ab|cd", "", { rightArrow: true })).toBe("abc|d");
    expect(press("ab|cd", "b", { ctrl: true })).toBe("a|bcd");
    expect(press("ab|cd", "f", { ctrl: true })).toBe("abc|d");
    expect(press("|abcd", "", { leftArrow: true })).toBe("|abcd");
    expect(press("abcd|", "", { rightArrow: true })).toBe("abcd|");
  });

  test("Home/End go to either end, unless the screen keeps them for scrolling", () => {
    expect(press("ab|cd", "", { home: true })).toBe("|abcd");
    expect(press("ab|cd", "", { end: true })).toBe("abcd|");
    expect(press("ab|cd", "", { home: true }, { homeEnd: false })).toBeUndefined();
    expect(press("ab|cd", "", { end: true }, { homeEnd: false })).toBeUndefined();
    // …and ^a/^e still work there.
    expect(press("ab|cd", "a", { ctrl: true }, { homeEnd: false })).toBe("|abcd");
    expect(press("ab|cd", "e", { ctrl: true }, { homeEnd: false })).toBe("abcd|");
  });

  test("words: Alt-b/f, and Alt or Ctrl with ←/→", () => {
    const t = "one two three";
    const at = (n: number) => `${t.slice(0, n)}|${t.slice(n)}`;
    expect(press(at(13), "b", { meta: true })).toBe("one two |three");
    expect(press(at(8), "b", { meta: true })).toBe("one |two three");
    expect(press(at(0), "f", { meta: true })).toBe("one| two three");
    expect(press(at(3), "f", { meta: true })).toBe("one two| three");
    for (const mod of [{ meta: true }, { ctrl: true }]) {
      expect(press(at(13), "", { leftArrow: true, ...mod })).toBe("one two |three");
      expect(press(at(0), "", { rightArrow: true, ...mod })).toBe("one| two three");
    }
    // An uppercase Alt-B is the same key.
    expect(press(at(13), "B", { meta: true })).toBe("one two |three");
  });

  test("Backspace deletes before the cursor, Delete under it", () => {
    expect(press("ab|cd", "", { delete: true }, { raw: "\x7f" })).toBe("a|cd");
    expect(press("ab|cd", "", { delete: true }, { raw: `${ESC}[3~` })).toBe("ab|d");
    expect(press("ab|cd", "", { backspace: true })).toBe("a|cd");
    expect(press("|abcd", "", { delete: true }, { raw: "\x7f" })).toBe("|abcd");
    expect(press("abcd|", "", { delete: true }, { raw: `${ESC}[3~` })).toBe("abcd|");
  });

  test("with no bytes to go on, `delete` is a Backspace — the key every terminal sends", () => {
    expect(press("ab|cd", "", { delete: true })).toBe("a|cd");
    expect(press("ab|cd", "", { delete: true }, { raw: "" })).toBe("a|cd");
  });

  test("word deletes: Alt-Backspace/Ctrl-Backspace back, Alt-d/Alt-Delete/Ctrl-Delete forward", () => {
    const t = "one two three";
    expect(press(`${t}|`, "", { delete: true, meta: true }, { raw: `${ESC}\x7f` })).toBe(
      "one two |",
    );
    expect(press(`${t}|`, "", { delete: true, ctrl: true }, { raw: `${ESC}[127;5u` })).toBe(
      "one two |",
    );
    expect(press(`|${t}`, "d", { meta: true })).toBe("| two three");
    expect(press(`|${t}`, "", { delete: true, meta: true }, { raw: `${ESC}[3;3~` })).toBe(
      "| two three",
    );
    expect(press(`|${t}`, "", { delete: true, ctrl: true }, { raw: `${ESC}[3;5~` })).toBe(
      "| two three",
    );
    // Alt as an Esc prefix: ESC ESC [ 3 ~ is Alt-Delete too, and deletes
    // FORWARD. Read as a Backspace it took the word behind the cursor.
    expect(press(`|${t}`, "", { delete: true, meta: true }, { raw: `${ESC}${ESC}[3~` })).toBe(
      "| two three",
    );
    expect(press(`${t}|`, "", { delete: true, meta: true }, { raw: `${ESC}${ESC}[3~` })).toBe(
      `${t}|`,
    );
  });

  test("^w deletes back to whitespace, ^u to the start, ^d under the cursor", () => {
    expect(press("cd /usr/local/bin|", "w", { ctrl: true })).toBe("cd |");
    expect(press("abc|def", "u", { ctrl: true })).toBe("|def");
    expect(press("ab|cd", "d", { ctrl: true })).toBe("ab|d");
    expect(press("abcd|", "d", { ctrl: true })).toBe("abcd|");
  });

  test("keys that are not editing keys are left for the screen", () => {
    expect(editKey(field("abc"), "", {})).toBeUndefined();
    expect(editKey(field("abc"), "x", {})).toBeUndefined(); // typed text
    expect(editKey(field("abc"), "x", { ctrl: true })).toBeUndefined();
    expect(editKey(field("abc"), "x", { meta: true })).toBeUndefined();
    // A bare Esc reports `meta`; it must not be read as Alt-<nothing>.
    expect(editKey(field("abc"), "", { meta: true })).toBeUndefined();
    // Ctrl-k is the chat's key inspector, not a kill.
    expect(editKey(field("abc"), "k", { ctrl: true })).toBeUndefined();
  });

  test("an emoji and a combining sequence are one character", () => {
    expect(press("a😀|b", "", { delete: true }, { raw: "\x7f" })).toBe("a|b");
    expect(press("a|😀b", "", { delete: true }, { raw: `${ESC}[3~` })).toBe("a|b");
    expect(press("a|😀b", "", { rightArrow: true })).toBe("a😀|b");
    expect(press("café|!", "", { backspace: true })).toBe("caf|!");
  });
});

describe("the Delete key is read from its bytes", () => {
  test("only ESC [ 3 … ~ is the Delete key", () => {
    for (const raw of [`${ESC}[3~`, `${ESC}[3;5~`, `${ESC}[3;3~`, `${ESC}[3;2~`, `${ESC}[3;1:1~`, `${ESC}[3$`, `${ESC}[3^`, `${ESC}${ESC}[3~`]) {
      expect(isDeleteKeySequence(raw)).toBe(true);
    }
    for (const raw of ["", "\x7f", "\x08", `${ESC}[127u`, `${ESC}[127;5u`, `${ESC}\x7f`, `${ESC}[13~`, `${ESC}[33~`, `${ESC}[2~`, `${ESC}${ESC}[D`, `${ESC}${ESC}${ESC}[3~`, "x", undefined]) {
      expect(isDeleteKeySequence(raw)).toBe(false);
    }
  });

  test("deleteKind", () => {
    expect(deleteKind({ delete: true }, `${ESC}[3~`)).toBe("forward");
    expect(deleteKind({ delete: true }, "\x7f")).toBe("backward");
    expect(deleteKind({ delete: true })).toBe("backward");
    expect(deleteKind({ backspace: true }, "\x08")).toBe("backward");
    // Bytes without Ink's flag are not a delete: the caller decides by `key`.
    expect(deleteKind({}, `${ESC}[3~`)).toBeUndefined();
    expect(deleteKind({}, "x")).toBeUndefined();
  });
});

describe("typeText: what a read of the terminal can carry", () => {
  const type = (at: string, text: string) => show(typeText(field(at.replace("|", ""), at.indexOf("|")), text));

  test("plain text goes in at the cursor", () => {
    expect(type("ad|", "bc")).toBe("adbc|");
    expect(type("a|d", "bc")).toBe("abc|d");
  });

  test("DEL and BS are Backspaces: keys that land in one read arrive as one string", () => {
    expect(type("abcde|", "\x7f\x7f")).toBe("abc|");
    expect(type("|", "abc\x7f")).toBe("ab|");
    expect(type("ab|", "\b\bcd")).toBe("cd|");
    expect(type("|", "\x7f\x7f")).toBe("|");
  });

  test("a tab is one space and every other control character is dropped", () => {
    expect(type("|", "a\tb")).toBe("a b|");
    expect(type("|", "a\x00b\x01c\x1bd\x9fe")).toBe("abcde|");
    // A newline that gets this far is dropped like the rest: what it MEANS
    // (Enter, a space, a line break) is decided by the caller, before this.
    expect(type("|", "a\nb\rc")).toBe("abc|");
  });

  test("typeLine turns a newline inside the text into a space, and drops one that ends it", () => {
    expect(show(typeLine(promptState(""), "a\nb\r\nc\rd"))).toBe("a b c d|");
    // The end of the line that was copied is not a space: "alice " would fail
    // the name gate, which compares exactly, with nothing to show why.
    expect(show(typeLine(promptState(""), "alice\n"))).toBe("alice|");
    expect(show(typeLine(promptState(""), "alice\r\n\r\n"))).toBe("alice|");
    expect(show(typeLine(field("ab", 1), "X\n"))).toBe("aX|b");
  });

  test("a chunk that types nothing hands back the very same state", () => {
    // `feedField` reads this to tell "typed" from "nothing happened".
    const state = field("x");
    expect(typeLine(state, "\n")).toBe(state);
    expect(typeText(state, "\x01")).toBe(state);
    expect(typeMultiline(state, "")).toBe(state);
  });
});

describe("typeMultiline: the chat prompt keeps its lines", () => {
  const type = (at: string, text: string) =>
    show(typeMultiline(field(at.replace("|", ""), at.indexOf("|")), text));

  test("every newline flavour stays, as ONE \\n, at the cursor", () => {
    expect(type("|", "a\nb\r\nc\rd")).toBe("a\nb\nc\nd|");
    expect(type("x|y", "1\r\n2")).toBe("x1\n2|y");
    expect(type("ab|", "\n")).toBe("ab\n|");
    expect(type("ab|", "c\n")).toBe("abc\n|");
  });

  test("each line is typed like any other text: DEL and BS delete, controls go", () => {
    expect(type("|", "one\ntwo\x7f\x7f\x01!")).toBe("one\nt!|");
    expect(type("abcdefgh|", "\x7f\x7f\x7f\x7f")).toBe("abcd|");
    expect(type("|", "ab\b\bcd")).toBe("cd|");
    expect(type("|", "x\x00y\x1bz\x9bw")).toBe("xyzw|");
  });

  test("a Backspace after a newline takes the newline, as the key would", () => {
    expect(type("|", "ab\n\x7f")).toBe("ab|");
    expect(type("ab\n|cd", "\x7f")).toBe("ab|cd");
  });

  test("a tab is two spaces: indentation, not a stray separator", () => {
    expect(type("|", "a\tb")).toBe("a  b|");
    expect(type("|", "if x:\n\treturn 1")).toBe("if x:\n  return 1|");
  });

  test("plain text is typed exactly as typeText types it", () => {
    for (const text of ["", "héllo wörld", "a😀b", "日本語", "  spaced  "]) {
      expect(typeMultiline(field("in", 1), text)).toEqual(typeText(field("in", 1), text));
    }
  });

  test("a long paste costs one pass over the field, not one per line", () => {
    // Typed line by line, every line re-reads the whole field: these 2,000
    // lines took more than 10 s that way, against less than 20 ms in one
    // insert. The bound sits far from both.
    const paste = "the quick brown fox jumps over the lazy dog\n".repeat(2000);
    const started = performance.now();
    const typed = typeMultiline(promptState(""), paste);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(typed.text).toBe(paste);
    expect(typed.cursor).toBe(paste.length);
  });

  test("garbage bytes never throw and leave no control character but \\n", () => {
    const rand = rng(11);
    let state = promptState("seed");
    for (let step = 0; step < 500; step++) {
      const chunk = Array.from({ length: Math.floor(rand() * 12) }, () =>
        String.fromCharCode(Math.floor(rand() * 0xa0)),
      ).join("");
      state = typeMultiline(state, chunk);
      // eslint-disable-next-line no-control-regex
      expect(state.text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
      expect(state.cursor).toBeGreaterThanOrEqual(0);
      expect(state.cursor).toBeLessThanOrEqual(graphemes(state.text).length);
    }
  });
});

describe("multilineSteps: what a chunk carries, for a buffer of its own", () => {
  test("runs of text, with a BACKSPACE wherever a DEL or BS byte was", () => {
    expect(multilineSteps("ab\x7f\x7fc\bd")).toEqual(["ab", BACKSPACE, BACKSPACE, "c", BACKSPACE, "d"]);
    expect(multilineSteps("\x7f")).toEqual([BACKSPACE]);
    expect(multilineSteps("")).toEqual([]);
  });

  test("newlines stay as one \\n, a tab is two spaces, other controls are dropped", () => {
    // One run: nothing in it is a Backspace, so it is one insert.
    expect(multilineSteps("a\r\nb\rc\td\x01e")).toEqual(["a\nb\nc  de"]);
  });
});

describe("carriesKeys: a chunk that is not only text", () => {
  test("any control character but a tab is a key", () => {
    for (const chunk of ["\x7f\x7f", "ab\x7f", "\bcd", "a\rb", "a\nb", "x\x01y", "x\x00", "x\x1b", "x\x9b"]) {
      expect(carriesKeys(chunk), JSON.stringify(chunk)).toBe(true);
    }
  });

  test("text is not, and neither is a tab inside it", () => {
    for (const chunk of ["", "abc", "a b", "a\tb", "/tmp/a\\ b.png ", "héllo 😀 日本", "\u00a0"]) {
      expect(carriesKeys(chunk), JSON.stringify(chunk)).toBe(false);
    }
  });
});

describe("applyTextChunkAt: a newline in a chunk is Enter", () => {
  test("no newline: just typed at the cursor, nothing submitted", () => {
    const r = applyTextChunkAt(field("ad", 1), "bc");
    expect(show(r.state)).toBe("abc|d");
    expect(r.submit).toBeUndefined();
  });

  test("text before the first newline completes the value AT THE CURSOR and submits it", () => {
    expect(applyTextChunkAt(field("ab", 1), "X\r").submit).toBe("aXb");
    expect(applyTextChunkAt(field("ali"), "ce\r").submit).toBe("alice");
    expect(applyTextChunkAt(field("alice"), "\r").submit).toBe("alice");
  });

  test("what follows the newline stays in the box, joined and trimmed", () => {
    const r = applyTextChunkAt(field(""), "alice\nand then\nsome");
    expect(r.submit).toBe("alice");
    expect(r.state.text).toBe("and then some");
  });

  test("every newline flavour counts, and CRLF is ONE newline", () => {
    for (const nl of ["\r", "\n", "\r\n"]) {
      expect(applyTextChunkAt(field("a"), `b${nl}`)).toEqual({
        state: { text: "", cursor: 0 },
        submit: "ab",
      });
    }
    expect(applyTextChunkAt(field(""), "a\r\nb").state.text).toBe("b");
  });

  test("a newline over an empty value submits nothing", () => {
    expect(applyTextChunkAt(field("  "), "\r")).toEqual({ state: { text: "", cursor: 0 } });
  });

  test("what follows the newline is typed too, not inserted as bytes", () => {
    // Nothing before the newline, so nothing is submitted and what follows is
    // what the box holds: its Backspace deletes, its tab is a space and the
    // other control character does not go in.
    const r = applyTextChunkAt(field(""), "\rab\x7f\tc\x01d");
    expect(r.submit).toBeUndefined();
    expect(show(r.state)).toBe("a cd|");
    expect(applyTextChunkAt(field(""), "\nfoo\tbar").state.text).toBe("foo bar");
    // The same after a submit.
    expect(applyTextChunkAt(field("x"), "\rab\x7f")).toEqual({
      state: { text: "a", cursor: 1 },
      submit: "x",
    });
  });
});

describe("limitLength and fieldParts", () => {
  test("limitLength cuts the end, by characters, and keeps the cursor inside", () => {
    expect(show(limitLength(field("abcdef"), 4))).toBe("abcd|");
    expect(show(limitLength(field("abcdef", 2), 4))).toBe("ab|cd");
    expect(show(limitLength(field("a😀b😀c"), 3))).toBe("a😀b|");
    const same = field("abc", 1);
    expect(limitLength(same, 3)).toBe(same);
  });

  test("the cursor cell is the character under it, or a blank past the end", () => {
    expect(fieldParts(field("abc", 1))).toEqual({ before: "a", at: "b", after: "c", atEnd: false });
    expect(fieldParts(field("abc"))).toEqual({ before: "abc", at: " ", after: "", atEnd: true });
    expect(fieldParts(field(""))).toEqual({ before: "", at: " ", after: "", atEnd: true });
    expect(fieldParts(field("a b", 1)).at).toBe(" ");
  });

  test("a masked field is dots, one per character, and never the text", () => {
    const parts = fieldParts(field("sk😀", 1), { masked: true });
    expect(parts).toEqual({ before: "•", at: "•", after: "•", atEnd: false });
    expect(parts.before + parts.at + parts.after).toBe("•••");
  });
});

// ---------------------------------------------------------------------------
// The oracle. A reference editor on plain strings, written to be obviously
// right rather than to share anything with `promptBox.ts`: ASCII only, so one
// UTF-16 unit is one character, and words found by scanning, not by sets.
// ---------------------------------------------------------------------------

interface Ref {
  text: string;
  cursor: number;
}
type Op =
  | { name: string; char: string; key: EditKey; raw?: string; ref: (s: Ref) => Ref };

const isWordCh = (c: string) => /[A-Za-z0-9]/.test(c);
const isSpaceCh = (c: string) => c === " ";

function wordLeft(s: Ref): number {
  let i = s.cursor;
  while (i > 0 && !isWordCh(s.text[i - 1]!)) i--;
  while (i > 0 && isWordCh(s.text[i - 1]!)) i--;
  return i;
}
function wordRight(s: Ref): number {
  let i = s.cursor;
  while (i < s.text.length && !isWordCh(s.text[i]!)) i++;
  while (i < s.text.length && isWordCh(s.text[i]!)) i++;
  return i;
}
function cut(s: Ref, from: number, to: number): Ref {
  const a = Math.max(0, from);
  const b = Math.min(s.text.length, to);
  return a >= b ? s : { text: s.text.slice(0, a) + s.text.slice(b), cursor: a };
}

const OPS: Op[] = [
  { name: "left", char: "", key: { leftArrow: true }, ref: (s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }) },
  { name: "right", char: "", key: { rightArrow: true }, ref: (s) => ({ ...s, cursor: Math.min(s.text.length, s.cursor + 1) }) },
  { name: "^b", char: "b", key: { ctrl: true }, ref: (s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }) },
  { name: "^f", char: "f", key: { ctrl: true }, ref: (s) => ({ ...s, cursor: Math.min(s.text.length, s.cursor + 1) }) },
  { name: "home", char: "", key: { home: true }, ref: (s) => ({ ...s, cursor: 0 }) },
  { name: "end", char: "", key: { end: true }, ref: (s) => ({ ...s, cursor: s.text.length }) },
  { name: "^a", char: "a", key: { ctrl: true }, ref: (s) => ({ ...s, cursor: 0 }) },
  { name: "^e", char: "e", key: { ctrl: true }, ref: (s) => ({ ...s, cursor: s.text.length }) },
  { name: "backspace", char: "", key: { delete: true }, raw: "\x7f", ref: (s) => cut(s, s.cursor - 1, s.cursor) },
  { name: "^h", char: "", key: { backspace: true }, raw: "\x08", ref: (s) => cut(s, s.cursor - 1, s.cursor) },
  { name: "delete", char: "", key: { delete: true }, raw: `${ESC}[3~`, ref: (s) => cut(s, s.cursor, s.cursor + 1) },
  { name: "^d", char: "d", key: { ctrl: true }, ref: (s) => cut(s, s.cursor, s.cursor + 1) },
  { name: "alt-b", char: "b", key: { meta: true }, ref: (s) => ({ ...s, cursor: wordLeft(s) }) },
  { name: "alt-f", char: "f", key: { meta: true }, ref: (s) => ({ ...s, cursor: wordRight(s) }) },
  { name: "ctrl-left", char: "", key: { leftArrow: true, ctrl: true }, ref: (s) => ({ ...s, cursor: wordLeft(s) }) },
  { name: "alt-right", char: "", key: { rightArrow: true, meta: true }, ref: (s) => ({ ...s, cursor: wordRight(s) }) },
  { name: "alt-backspace", char: "", key: { delete: true, meta: true }, raw: `${ESC}\x7f`, ref: (s) => cut(s, wordLeft(s), s.cursor) },
  { name: "alt-d", char: "d", key: { meta: true }, ref: (s) => cut(s, s.cursor, wordRight(s)) },
  { name: "ctrl-delete", char: "", key: { delete: true, ctrl: true }, raw: `${ESC}[3;5~`, ref: (s) => cut(s, s.cursor, wordRight(s)) },
  {
    name: "^w",
    char: "w",
    key: { ctrl: true },
    ref: (s) => {
      let i = s.cursor;
      while (i > 0 && isSpaceCh(s.text[i - 1]!)) i--;
      while (i > 0 && !isSpaceCh(s.text[i - 1]!)) i--;
      return cut(s, i, s.cursor);
    },
  },
  { name: "^u", char: "u", key: { ctrl: true }, ref: (s) => cut(s, 0, s.cursor) },
];

/** mulberry32: a seeded generator, so a failure replays exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("editKey against a naive reference, over random key sequences", () => {
  const ALPHABET = ["a", "b", "z", "Q", "0", "7", " ", " ", "-", "/", "."];

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test(`seed ${seed}: 500 steps, every step agrees`, () => {
      const rand = rng(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
      let got: PromptState = promptState("");
      let want: Ref = { text: "", cursor: 0 };
      const trail: string[] = [];
      for (let step = 0; step < 500; step++) {
        if (rand() < 0.4) {
          const text = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(ALPHABET)).join("");
          trail.push(`type ${JSON.stringify(text)}`);
          got = typeText(got, text);
          want = {
            text: want.text.slice(0, want.cursor) + text + want.text.slice(want.cursor),
            cursor: want.cursor + text.length,
          };
        } else {
          const op = pick(OPS);
          trail.push(op.name);
          const next = editKey(got, op.char, op.key, { raw: op.raw });
          expect(next, `${op.name} must be an editing key`).toBeDefined();
          got = next!;
          want = op.ref(want);
        }
        if (got.text !== want.text || got.cursor !== want.cursor) {
          throw new Error(
            `diverged at step ${step} (seed ${seed})\n  trail: ${trail.slice(-12).join(" → ")}\n  got:  ${show(got)}\n  want: ${show(want)}`,
          );
        }
      }
    });
  }
});

describe("the cursor is always on a character boundary, over any text", () => {
  const POOL = ["a", "é", "é", "😀", "👨‍👩‍👧", "日", "本", " ", "-", "🇦🇷", "‍"];

  test("2000 random edits over emoji, CJK and combining marks", () => {
    const rand = rng(99);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    let state = promptState("");
    for (let step = 0; step < 2000; step++) {
      if (rand() < 0.45) {
        state = typeText(state, Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(POOL)).join(""));
      } else {
        const op = pick(OPS);
        state = editKey(state, op.char, op.key, { raw: op.raw }) ?? state;
      }
      const count = graphemes(state.text).length;
      expect(Number.isInteger(state.cursor)).toBe(true);
      expect(state.cursor).toBeGreaterThanOrEqual(0);
      expect(state.cursor).toBeLessThanOrEqual(count);
      // The drawn parts spell the field back: nothing is lost around the cell.
      const parts = fieldParts(state);
      const cell = parts.atEnd || /^\s+$/.test(parts.at) ? graphemes(state.text)[state.cursor] ?? "" : parts.at;
      expect(parts.before + cell + parts.after).toBe(state.text);
      // …and a masked field never contains the text, only dots of equal length.
      const masked = fieldParts(state, { masked: true });
      expect(graphemes(masked.before + (masked.atEnd ? "" : masked.at) + masked.after)).toHaveLength(count);
    }
  });

  test("garbage bytes never throw and never leave a control character behind", () => {
    const rand = rng(7);
    let state = promptState("seed");
    for (let step = 0; step < 500; step++) {
      const chunk = Array.from({ length: Math.floor(rand() * 12) }, () =>
        String.fromCharCode(Math.floor(rand() * 0xa0)),
      ).join("");
      state = limitLength(typeText(state, chunk), 64);
      // eslint-disable-next-line no-control-regex
      expect(state.text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(graphemes(state.text).length).toBeLessThanOrEqual(64);
      expect(state.cursor).toBeLessThanOrEqual(graphemes(state.text).length);
    }
  });
});
