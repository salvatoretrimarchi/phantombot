/**
 * No screen edits a value by hand.
 *
 * The bug this guards against was copied into four screens: each kept its own `text + char` and `text.slice(0, -1)`, which is an
 * append-only field — no cursor, nothing to fix a typo with but deleting
 * everything after it. Fixing one screen leaves the next one broken, so the
 * rule is structural: a typed value is edited by `lineEditor.ts` (through
 * `useTextField`/`feedField`), and a screen does not read the Backspace or
 * Delete flag or trim a string's last character itself.
 *
 * A screen with a legitimate reason is named below, with the reason. Adding to
 * this list means a second idea of what Backspace does — add a rule to
 * `docs/contributing/invariants/cli-tui-and-wizards.md` first.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TUI = join(ROOT, "src", "tui");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Code only: comments and string literals are where these words are explained. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

/** The files that may read the Backspace/Delete flag, and why. */
const MAY_READ_DELETE_FLAGS: Record<string, string> = {
  "src/tui/lineEditor.ts": "it IS the key map",
  "src/tui/screens/Chat.tsx":
    "`isPlainText` only: a delete key is not text, so it ends a drop run",
};

describe("typed values are edited by one editor", () => {
  const files = sources(TUI).map((path) => ({
    path,
    rel: relative(ROOT, path),
    text: code(readFileSync(path, "utf8")),
  }));

  test("only the key map reads key.backspace / key.delete", () => {
    const offenders = files
      .filter((f) => /\bkey\.(backspace|delete)\b/.test(f.text))
      .map((f) => f.rel)
      .filter((rel) => !(rel in MAY_READ_DELETE_FLAGS));
    expect(
      offenders,
      "a screen that deletes by `key.backspace`/`key.delete` has its own Backspace — " +
        "use `feedField` (a text field) or `deleteKind` (a buffer), which read the bytes",
    ).toEqual([]);
  });

  test("no screen or component trims a typed value with slice(0, -1)", () => {
    const offenders = files
      .filter((f) => /\/(screens|components)\//.test(f.rel))
      .filter((f) => /\.slice\(\s*0\s*,\s*-1\s*\)/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test("the allow-list is real: every file named in it still needs the entry", () => {
    for (const rel of Object.keys(MAY_READ_DELETE_FLAGS)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} no longer exists — drop it from the list`).toBeDefined();
      expect(
        /\bkey\.(backspace|delete)\b/.test(f!.text),
        `${rel} no longer reads the flag — drop it from the list`,
      ).toBe(true);
    }
  });

  test("every screen that takes typed text goes through feedField", () => {
    // A `useInput`/`useStableInput` handler that inserts the characters it is
    // given — `char && !key.ctrl && !key.meta` — is a text field. It may be the
    // chat box (its own buffer, with image drops and Enter-batching), but it
    // may not be anything else.
    const OWN_BUFFER = new Set([
      "src/tui/screens/Chat.tsx", // image drops, batched Enter, multi-line: promptBox.ts
      "src/tui/screens/FileEditor.tsx", // a multi-line buffer: editorBuffer.ts
    ]);
    const offenders = files
      .filter((f) => /\/screens\//.test(f.rel))
      .filter((f) => /!key\.ctrl\s*&&\s*!key\.meta/.test(f.text))
      .filter((f) => !/\bfeedField\b/.test(f.text))
      .map((f) => f.rel)
      .filter((rel) => !OWN_BUFFER.has(rel));
    expect(offenders).toEqual([]);
  });
});
