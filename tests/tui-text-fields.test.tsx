/**
 * Every typed value in the TUI has a cursor.
 *
 * The harness setup's "Base URL" question used to be append-only: typing and
 * Backspace worked, ←/→/Home/End/Delete did nothing, so a typo in the middle of
 * a long value meant deleting everything after it and retyping it. The same
 * hand-rolled `slice(0, -1)` was copied into the search box, the log filter and
 * the typed-name gate. These tests drive each of those screens with the BYTES a
 * terminal sends, through the real Ink input path, and read the answer the
 * screen hands back — so they fail on a field that merely looks editable.
 *
 * The pure key map is pinned in `tui-line-editor.test.ts`; this file pins that
 * every screen that takes a typed value is wired to it (the chat's keys are in
 * `tui-chat-delete-keys.test.tsx`).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AskScreen, type AskRequest } from "../src/tui/screens/Ask.tsx";
import { ConfirmScreen } from "../src/tui/screens/Confirm.tsx";
import { FileEditorScreen } from "../src/tui/screens/FileEditor.tsx";
import { SearchListScreen } from "../src/tui/screens/SearchList.tsx";
import { SystemScreen } from "../src/tui/screens/System.tsx";
import type { LogLine } from "../src/tui/logBuffer.ts";
import type { LogSource } from "../src/tui/logSources.ts";
import {
  forceColor,
  KEYS as K,
  mountInk,
  sleep,
  type Mounted,
} from "./helpers/inkMount.tsx";

let color: { restore: () => void };
beforeAll(() => {
  color = forceColor();
});
afterAll(() => color.restore());

let open: Mounted[] = [];
afterEach(() => {
  for (const m of open) m.unmount();
  open = [];
});
function track(m: Mounted): Mounted {
  open.push(m);
  return m;
}

/** Mount the value question and collect what it answers. */
function ask(request: Partial<AskRequest> = {}) {
  const answers: Array<string | undefined> = [];
  const app = track(
    mountInk(
      <AskScreen
        request={{ title: "Base URL", ...request }}
        onAnswer={(v) => answers.push(v)}
      />,
    ),
  );
  return { app, answers };
}

/** Type `text`, press the keys, hit Enter, return what the screen answered. */
async function answerAfter(
  text: string,
  keys: string[],
  request: Partial<AskRequest> = {},
): Promise<string | undefined> {
  const { app, answers } = ask(request);
  if (text) await app.press(text);
  for (const key of keys) await app.press(key);
  await app.press(K.enter);
  return answers.at(-1);
}

describe("the value question: a cursor, not a tail", () => {
  test("a typo in the middle is fixed where it is, not by retyping the tail", async () => {
    // The reported bug, in its own words: "htp" for "http", with a long tail.
    expect(
      await answerAfter("htp://localhost:11434/v1", [K.home, K.right, K.right, "t"]),
    ).toBe("http://localhost:11434/v1");
  });

  test("←/→ move one character, and the cursor cell shows where", async () => {
    const { app } = ask();
    await app.press("abcd");
    expect(app.marked()).toContain("abcd⟦ ⟧");
    await app.press(K.left);
    expect(app.marked()).toContain("abc⟦d⟧");
    await app.press(K.left);
    await app.press(K.left);
    expect(app.marked()).toContain("a⟦b⟧cd");
    await app.press(K.right);
    expect(app.marked()).toContain("ab⟦c⟧d");
  });

  test("the arrows work in application cursor mode too (ESC O D)", async () => {
    // The TUI switches DECCKM on (terminal.ts), so a real terminal sends these.
    expect(await answerAfter("abcd", [K.leftApp, K.leftApp, "X"])).toBe("abXcd");
    expect(await answerAfter("abcd", [K.home, K.rightApp, "X"])).toBe("aXbcd");
  });

  test("the cursor stops at both ends instead of wrapping or throwing", async () => {
    expect(await answerAfter("ab", [K.left, K.left, K.left, K.left, "X"])).toBe("Xab");
    expect(await answerAfter("ab", [K.right, K.right, "X"])).toBe("abX");
  });

  test("typing inserts AT the cursor", async () => {
    expect(await answerAfter("ad", [K.left, "bc"])).toBe("abcd");
  });

  test("Backspace deletes the character BEFORE the cursor", async () => {
    expect(await answerAfter("abcd", [K.left, K.left, K.backspace])).toBe("acd");
    // ^H, which some terminals send for the Backspace key, is the same key.
    expect(await answerAfter("abcd", [K.left, K.ctrlH])).toBe("abd");
    // Kitty-protocol terminals send CSI 127 u.
    expect(await answerAfter("abcd", [K.left, K.kittyBackspace])).toBe("abd");
  });

  test("the Delete key deletes the character UNDER the cursor", async () => {
    expect(await answerAfter("abcd", [K.left, K.left, K.deleteKey])).toBe("abd");
    expect(await answerAfter("abcd", [K.home, K.deleteKey])).toBe("bcd");
    // Past the end there is nothing under the cursor: a no-op, not a backspace.
    expect(await answerAfter("abcd", [K.deleteKey])).toBe("abcd");
  });

  test("Home/End and ^a/^e jump to either end", async () => {
    expect(await answerAfter("bcd", [K.home, "a"])).toBe("abcd");
    expect(await answerAfter("bcd", [K.homeTilde, "a"])).toBe("abcd");
    expect(await answerAfter("abc", [K.home, K.end, "d"])).toBe("abcd");
    expect(await answerAfter("abc", [K.home, K.endTilde, "d"])).toBe("abcd");
    expect(await answerAfter("bcd", [K.ctrlA, "a"])).toBe("abcd");
    expect(await answerAfter("abc", [K.ctrlA, K.ctrlE, "d"])).toBe("abcd");
  });

  test("^b/^f step like the arrows", async () => {
    expect(await answerAfter("abcd", [K.ctrlB, K.ctrlB, "X"])).toBe("abXcd");
    expect(await answerAfter("abcd", [K.home, K.ctrlF, "X"])).toBe("aXbcd");
  });

  test("words move with Alt-b/f, Alt-←/→ and Ctrl-←/→", async () => {
    const text = "one two three";
    expect(await answerAfter(text, [K.altB, "X"])).toBe("one two Xthree");
    expect(await answerAfter(text, [K.altB, K.altB, "X"])).toBe("one Xtwo three");
    expect(await answerAfter(text, [K.ctrlLeft, K.ctrlLeft, "X"])).toBe("one Xtwo three");
    expect(await answerAfter(text, [K.altLeft, "X"])).toBe("one two Xthree");
    expect(await answerAfter(text, [K.home, K.altF, "X"])).toBe("oneX two three");
    expect(await answerAfter(text, [K.home, K.ctrlRight, K.ctrlRight, "X"])).toBe(
      "one twoX three",
    );
    expect(await answerAfter(text, [K.home, K.altRight, "X"])).toBe("oneX two three");
  });

  test("deletes by word, to the line start, and under the cursor", async () => {
    // (An answer is trimmed, so the space a word delete leaves is not seen.)
    // Alt-Backspace and Ctrl-Backspace (kitty): the word before the cursor.
    expect(await answerAfter("one two three", [K.altBackspace])).toBe("one two");
    expect(await answerAfter("one two three", [K.kittyCtrlBackspace])).toBe("one two");
    expect(await answerAfter("one two three", [K.altBackspace, K.altBackspace])).toBe("one");
    // Alt-d and Ctrl-Delete: the word after it, the space stays.
    expect(await answerAfter("one two three", [K.home, K.altD])).toBe("two three");
    expect(await answerAfter("one two three", [K.home, K.ctrlDelete])).toBe("two three");
    expect(await answerAfter("one two three", [K.home, K.altDelete])).toBe("two three");
    // Alt-Delete with Alt as an Esc prefix (ESC ESC [ 3 ~) is the same key.
    expect(await answerAfter("one two three", [K.home, K.altDeleteEsc])).toBe("two three");
    // ^w: back to the previous space, so a whole path goes in one press.
    expect(await answerAfter("cd /usr/local/bin", [K.ctrlW])).toBe("cd");
    // ^u: back to the start of the line; text after the cursor stays.
    expect(await answerAfter("abcdef", [K.left, K.left, K.ctrlU])).toBe("ef");
    // ^d: the character under the cursor.
    expect(await answerAfter("abcd", [K.home, K.ctrlD])).toBe("bcd");
  });

  test("a paste lands at the cursor, not at the end", async () => {
    const { app, answers } = ask();
    await app.press("ad");
    await app.press(K.left);
    await app.press("bc"); // one chunk, as a terminal delivers a paste
    await app.press(K.enter);
    expect(answers).toEqual(["abcd"]);
  });

  test("a chunk ending in a newline submits the WHOLE value, edited in place", async () => {
    // Keystrokes the terminal batched: "X" then Enter, typed with the cursor
    // in the middle. The value is "aXb", not "abX" and not "aX".
    const { app, answers } = ask();
    await app.press("ab");
    await app.press(K.left);
    await app.press("X\r");
    expect(answers).toEqual(["aXb"]);
  });

  test("an edited value is trimmed like any other answer, and empty is not one", async () => {
    expect(await answerAfter("  abc  ", [])).toBe("abc");
    expect(await answerAfter("a", [K.backspace])).toBeUndefined();
  });

  test("a held Backspace that arrives as one chunk deletes, never types DEL", async () => {
    // Ink hands "\x7f\x7f\x7f" over as ONE string of characters, not three key
    // events. It used to be inserted into the value as three invisible bytes.
    expect(await answerAfter("abcde", ["\x7f\x7f"])).toBe("abc");
    expect(await answerAfter("", ["abc\x7f"])).toBe("ab");
    expect(await answerAfter("ab", ["\x7f\x7f\x7f\x7fcd"])).toBe("cd");
  });

  test("control characters in a paste are dropped; a tab becomes a space", async () => {
    expect(await answerAfter("", ["a\x01b\x02c"])).toBe("abc");
    expect(await answerAfter("", ["a\tb"])).toBe("a b");
  });

  test("keys that follow a newline in the chunk are typed too", async () => {
    // An empty box: nothing stands before the newline, so nothing is submitted
    // and what follows is what the box holds. It is typed like any other text:
    // its Backspace deletes, its tab is a space, its control character goes.
    expect(await answerAfter("", ["\rab\x7f\tc\x01d"])).toBe("a cd");
  });

  test("an emoji is ONE character to the cursor and to Backspace", async () => {
    expect(await answerAfter("a😀b", [K.left, K.backspace])).toBe("ab");
    expect(await answerAfter("a😀b", [K.left, K.left, "X"])).toBe("aX😀b");
    expect(await answerAfter("日本語", [K.left, K.backspace])).toBe("日語");
    // A combining sequence (e + acute) is one character too.
    expect(await answerAfter("cafe\u0301!", [K.left, K.backspace])).toBe("caf!");
  });

  test("a combining mark typed on its own leaves the cursor after its character", async () => {
    // "ex", cursor after the e, then U+0301 as its own keystroke and a Z: the
    // Z follows the \u00e9. Counted on its own, the mark put the cursor one
    // character further on and the Z landed after the x.
    expect(await answerAfter("ex", [K.left, "\u0301", "Z"])).toBe("e\u0301Zx");
  });

  test("an initial value opens with the cursor at its end, ready to edit", async () => {
    expect(
      await answerAfter("", [K.left, K.backspace], { initial: "http://x/v1" }),
    ).toBe("http://x/1");
    const { app } = ask({ initial: "abc" });
    await app.press("");
    expect(app.marked()).toContain("abc⟦ ⟧");
  });

  test("esc still cancels as undefined, mid-edit", async () => {
    const { app, answers } = ask();
    await app.press("abc");
    await app.press(K.left);
    await app.press(K.esc);
    expect(answers).toEqual([undefined]);
  });

  test("a masked value is edited the same way and never drawn", async () => {
    const { app, answers } = ask({ title: "Set KEY", masked: true });
    await app.press("sk-secret");
    await app.press(K.left);
    await app.press(K.left);
    await app.press("X");
    // The value row is nothing but dots (the title says "secret", so look at
    // the row, not the frame). Ten characters now: the cursor sits after the X,
    // on the second-to-last dot.
    const row = app.marked().split("\n").find((l) => l.includes("›"));
    expect(row?.trim()).toBe(`› ${"•".repeat(8)}⟦•⟧•`);
    await app.press(K.enter);
    expect(answers).toEqual(["sk-secrXet"]);
  });

  test("a long value wraps as ONE paragraph, with the cursor inside it", async () => {
    const long = `https://example.com/${"segment/".repeat(14)}end`;
    const { app, answers } = ask();
    await app.press(long);
    await app.press(K.home);
    await app.press("X");
    const marked = app.marked();
    expect(marked).toContain("› X");
    expect(marked).toContain("⟦h⟧ttps");
    await app.press(K.enter);
    expect(answers).toEqual([`X${long}`]);
  });
});

describe("the search box: a cursor, and a list that follows the text", () => {
  const options = [
    { value: "alpha", label: "alpha" },
    { value: "beta", label: "beta" },
    { value: "gamma", label: "gamma" },
    { value: "delta", label: "delta" },
  ];

  function search() {
    const answers: Array<string | undefined> = [];
    const app = track(
      mountInk(
        <SearchListScreen request={{ title: "Model", options }} onAnswer={(v) => answers.push(v)} />,
      ),
    );
    return { app, answers };
  }

  test("a typo in the query is fixed in place and the list re-filters", async () => {
    const { app } = search();
    await app.press("bxta"); // "beta" with the wrong letter
    expect(app.frame()).toContain("0/4");
    await app.press(K.left);
    await app.press(K.left);
    await app.press(K.backspace);
    await app.press("e");
    expect(app.frame()).toContain("1/4");
    expect(app.marked()).toContain("be⟦t⟧a");
  });

  test("the free-text answer is the edited query", async () => {
    const { app, answers } = search();
    await app.press("gpt-5");
    await app.press(K.home);
    await app.press("openai/");
    await app.press(K.enter);
    expect(answers).toEqual(["openai/gpt-5"]);
  });

  test("Delete, Home and End edit the query; ↑↓ still move the list", async () => {
    const { app, answers } = search();
    await app.press("xta");
    expect(app.frame()).toContain("0/4");
    await app.press(K.home);
    await app.press(K.deleteKey); // "ta": beta and delta
    expect(app.frame()).toContain("2/4");
    await app.press(K.end);
    await app.press("x");
    expect(app.frame()).toContain("0/4");
    await app.press(K.backspace);
    expect(app.frame()).toContain("2/4");
    await app.press(K.down);
    await app.press(K.enter);
    expect(answers).toEqual(["delta"]);
  });

  test("a pasted newline is whitespace in the query, never an answer", async () => {
    const { app, answers } = search();
    await app.press("xx\nyy");
    expect(answers).toEqual([]);
    expect(app.frame()).toContain('use "xx yy" as typed');
  });

  test("a lone newline types nothing and leaves the highlighted row where it is", async () => {
    // ^J reaches the box as "\n": not Enter here, and not text either.
    const { app, answers } = search();
    await app.press(K.down); // beta
    await app.press("\n");
    expect(answers).toEqual([]);
    await app.press(K.enter);
    expect(answers).toEqual(["beta"]);
  });
});

describe("the typed-name gate: edit the name, it is still exact", () => {
  function gate(name = "alice") {
    const answers: boolean[] = [];
    const app = track(
      mountInk(
        <ConfirmScreen
          request={{
            title: `Remove ${name}?`,
            danger: true,
            confirmName: name,
            consequence: { summary: "removes it", detail: "", longRunning: false, restarts: false },
          }}
          onAnswer={(yes) => answers.push(yes)}
        />,
      ),
    );
    return { app, answers };
  }

  test("a typo in the name is fixed in place, and only the exact name unlocks Yes", async () => {
    const { app, answers } = gate();
    await app.press("alixe");
    await app.press(K.left);
    await app.press(K.backspace);
    await app.press("c");
    expect(app.marked()).toContain("alic⟦e⟧");
    await app.press(K.up); // select "Yes"
    await app.press(K.enter);
    expect(answers).toEqual([true]);
  });

  test("a wrong name stays inert however it was edited", async () => {
    const { app, answers } = gate();
    await app.press("alic");
    await app.press(K.home);
    await app.press("x");
    await app.press(K.up);
    await app.press(K.enter);
    expect(answers).toEqual([]);
  });

  test("a name pasted with the newline that ended its line still unlocks Yes", async () => {
    // Copying a whole line brings its newline along. A newline is never Enter
    // here; as a trailing space it would leave "alice " in the box, which is
    // not the name, with nothing on screen to show why Yes stays inert.
    for (const pasted of ["alice\n", "alice\r\n"]) {
      const { app, answers } = gate();
      await app.press(pasted);
      await app.press(K.up); // select "Yes"
      await app.press(K.enter);
      expect(answers, JSON.stringify(pasted)).toEqual([true]);
    }
  });

  test("←/→ edit the name here and ↑↓ still choose Yes or No", async () => {
    const { app, answers } = gate();
    await app.press("alice");
    await app.press(K.left); // must not select Yes
    await app.press(K.enter); // the cursor is still on "No"
    expect(answers).toEqual([false]);
  });

  test("without a gate, ←/→ still choose between Yes and No", async () => {
    const answers: boolean[] = [];
    const app = track(
      mountInk(
        <ConfirmScreen
          request={{
            title: "Apply?",
            consequence: { summary: "x", detail: "", longRunning: false, restarts: false },
          }}
          onAnswer={(yes) => answers.push(yes)}
        />,
      ),
    );
    await app.press(K.right);
    await app.press(K.enter);
    expect(answers).toEqual([false]);
  });

  test("the name is capped at 64 characters", async () => {
    const { app } = gate();
    await app.press("x".repeat(80));
    expect(app.frame()).toContain("x".repeat(64));
    expect(app.frame()).not.toContain("x".repeat(65));
  });
});

describe("the log filter: a cursor, with Home/End still scrolling", () => {
  const lines: LogLine[] = Array.from({ length: 200 }, (_, i) => ({
    at: Date.UTC(2026, 8, 1, 12, 0, 0) + i * 1000,
    level: "info",
    msg: `line-${String(i).padStart(3, "0")}`,
    type: "test",
    raw: "",
  }));
  const source: LogSource = {
    id: "session",
    label: "session",
    location: "/tmp/tall.log",
    command: "cat /tmp/tall.log",
    available: true,
    read: async () => lines,
  };

  async function logs() {
    const app = track(
      mountInk(
        <SystemScreen
          snapshot={{ capturedAt: "2026-09-01T12:00:00Z", services: [] }}
          host={{
            version: "test",
            updateChannel: "stable",
            defaultPersona: "kai",
            personasDir: "/tmp/none",
            personas: [],
          }}
          personas={["kai"]}
          onBack={() => {}}
          sources={[source]}
        />,
        { columns: 120, rows: 40 },
      ),
    );
    await app.press("\t"); // overview → logs
    await app.press("/"); // focus the filter
    return app;
  }

  test("a typo in the filter is fixed in place, and the cursor is drawn there", async () => {
    const app = await logs();
    await app.press("lixe-1"); // "line-1" with the wrong letter
    await app.press(K.left);
    await app.press(K.left);
    await app.press(K.left); // just after the x
    await app.press(K.backspace);
    await app.press("n");
    expect(app.frame()).toContain("filter: line-1");
    expect(app.marked()).toContain("filter: lin⟦e⟧-1 ◂ typing");
    expect(app.frame()).toContain("100/200"); // "line-1" matches line-100…199
  });

  test("Delete, ^a and ^e edit the filter", async () => {
    const app = await logs();
    await app.press("xline");
    await app.press(K.ctrlA);
    await app.press(K.deleteKey);
    expect(app.marked()).toContain("filter: ⟦l⟧ine ◂ typing");
    await app.press(K.ctrlE);
    await app.press("-19");
    expect(app.marked()).toContain("filter: line-19⟦ ⟧◂ typing");
  });

  test("Home and End scroll the log; they never move the filter's cursor", async () => {
    const app = await logs();
    await app.press("line");
    await app.press(K.left);
    await app.press(K.home);
    expect(app.frame()).toContain("line-000"); // scrolled to the oldest line
    await app.press("Z");
    // The cursor was one in from the end before Home, and still is.
    expect(app.frame()).toContain("filter: linZe ◂ typing");
  });

  test("typing without focus appends at the end, wherever the cursor was left", async () => {
    const app = await logs();
    await app.press("abc");
    await app.press(K.left);
    await app.press(K.left);
    await app.press(K.esc); // leave the box with the cursor in the middle
    expect(app.frame()).toContain("filter: abc (/ to search)");
    await app.press("d"); // not a shortcut: it is typed
    expect(app.frame()).toContain("filter: abcd (/ to search)");
    await app.press(K.backspace);
    expect(app.frame()).toContain("filter: abc (/ to search)");
  });

  test("a pasted newline is a space in the filter", async () => {
    const app = await logs();
    await app.press("two\nwords");
    expect(app.frame()).toContain("filter: two words ◂ typing");
  });

  test("a filter pasted with its line's newline matches like the same text typed", async () => {
    const app = await logs();
    await app.press("line-19\n");
    expect(app.marked()).toContain("filter: line-19⟦ ⟧◂ typing");
    expect(app.frame()).toContain("10/200"); // line-190…199
  });
});

describe("the identity editor: Backspace is Backspace", () => {
  // One scratch directory for the whole block, removed afterwards: a test that
  // makes a fresh one per case leaves a pile of them in the system temp dir.
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "tui-text-fields-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function editor(content: string) {
    const path = join(dir, "SOUL.md");
    writeFileSync(path, content);
    const results: unknown[] = [];
    const app = track(
      mountInk(
        <FileEditorScreen path={path} personaName="testbot" onBack={(r) => results.push(r)} />,
        { columns: 140, rows: 40 },
      ),
    );
    return { app, path, results };
  }

  async function saved(content: string, keys: string[]): Promise<string> {
    const { app, path } = editor(content);
    await sleep(150); // the file is read asynchronously
    await app.pressAll(...keys);
    await app.press("\x13"); // ^s saves in place
    await sleep(80);
    return readFileSync(path, "utf8");
  }

  test("the Backspace key deletes BEFORE the cursor, the Delete key under it", async () => {
    // Ink names 0x7f `delete`. The editor mapped `delete` to a FORWARD delete,
    // so the Backspace key (0x7f) removed the character after the cursor: at
    // the end of a line that is the line break, so the next line came up, and
    // at the end of the file it removed nothing.
    expect(await saved("abcd", [K.end, K.backspace])).toBe("abc");
    expect(await saved("abcd", [K.end, K.left, K.backspace])).toBe("abd");
    expect(await saved("abcd", [K.deleteKey])).toBe("bcd");
    expect(await saved("abcd", [K.end, K.deleteKey])).toBe("abcd");
    // At the end of a line that has another below it: the character before
    // the cursor goes and the next line stays where it is.
    expect(await saved("ab\ncd", [K.end, K.backspace])).toBe("a\ncd");
    // Alt as an Esc prefix in front of the Delete key (ESC ESC [ 3 ~) is
    // still the Delete key. Read as a Backspace it took the character before
    // the cursor: "bcd".
    expect(await saved("abcd", [K.right, K.altDeleteEsc])).toBe("acd");
  });

  test("^H and kitty's CSI 127 u are Backspace too", async () => {
    expect(await saved("abcd", [K.end, K.ctrlH])).toBe("abc");
    expect(await saved("abcd", [K.end, K.kittyBackspace])).toBe("abc");
  });

  test("keys that land in one read are typed, not saved into the file as bytes", async () => {
    // Two Backspace presses read together reach the screen as "\x7f\x7f".
    expect(await saved("abcd", [K.end, "\x7f\x7f"])).toBe("ab");
    expect(await saved("abcd", [K.end, "xy\x7fz"])).toBe("abcdxz");
    // Other control characters do not go in, and a tab is two spaces.
    expect(await saved("", ["x\x01y\tz"])).toBe("xy  z");
    // A paste keeps its lines.
    expect(await saved("", ["one\r\ntwo"])).toBe("one\ntwo");
  });
});
