/**
 * A chunk typed into the chat prompt can carry keys (rule 89).
 *
 * Ink splits a read only at ESC, so Backspaces that land in one read reach the
 * chat screen as ONE string, `"\x7f\x7f\x7f\x7f"`, with no key flag set. The
 * chat box inserted that string as it came: nothing was deleted, the bytes
 * went into the prompt and into the message that was sent, and each one cut a
 * cell off the end of the drawn row. A tab went in raw as well.
 *
 * The chat prompt now types every chunk through the shared editor
 * (`typeMultiline` in `lineEditor.ts`). These drive the REAL chat screen with
 * the bytes a terminal sends and read back what the box shows and what is
 * sent. The pure rule is pinned in `tui-line-editor.test.ts`; the image-drop
 * side of it in `tui-chat-image-drop.test.tsx`.
 */

import { describe, expect, test } from "bun:test";

import { ChatScreen } from "../src/tui/screens/Chat.tsx";
import type { ChatSession } from "../src/tui/chatSession.ts";
import { TranscriptStore } from "../src/tui/transcriptStore.ts";
import { TurnStore } from "../src/tui/turnRunner.ts";
import { KEYS, mountInk, sleep } from "./helpers/inkMount.tsx";

/** The prompt box's rows in a frame, without the `› ` prefix and the indent. */
function boxRows(frame: string): string[] {
  const lines = frame.split("\n");
  // An empty box is the prefix alone: the frame's trailing blanks are trimmed.
  const first = lines.findIndex((line) => /^\s*›(\s|$)/.test(line));
  if (first < 0) throw new Error(`no prompt row in frame:\n${frame}`);
  const rows = [lines[first]!.replace(/^\s*› ?/, "")];
  for (const line of lines.slice(first + 1)) {
    // A continuation row is indented under the prefix; the rule below is not.
    if (!/^ {4}\S/.test(line)) break;
    rows.push(line.slice(4));
  }
  return rows.map((row) => row.replace(/\s+$/u, ""));
}

async function chat() {
  const sent: string[] = [];
  const session: ChatSession = {
    persona: "lab",
    conversation: "cli:tui:lab",
    transcript: new TranscriptStore([]),
    turn: new TurnStore(),
    submit: async (text: string) => void sent.push(text),
    abortTurn: () => {},
    async *send() {},
    async command() {
      return null;
    },
    async reloadHarnesses() {
      return [];
    },
    async close() {},
  };
  const app = mountInk(
    <ChatScreen session={session} status="channel: stable" onSettings={() => {}} onQuit={() => {}} />,
    { columns: 100, rows: 20 },
  );
  await sleep(60);
  return { app, sent, box: () => boxRows(app.frame()) };
}

describe("a chunk typed into the chat prompt can carry keys (rule 89)", () => {
  test("Backspaces that land in one read each delete a character", async () => {
    const { app, sent, box } = await chat();
    try {
      await app.press("abcdefgh");
      await app.press("\x7f\x7f\x7f\x7f");
      expect(box()).toEqual(["abcd"]);
      // What is typed next is drawn: no invisible byte is left to hide it.
      await app.press("Z");
      expect(box()).toEqual(["abcdZ"]);
      await app.press(KEYS.enter);
      expect(sent).toEqual(["abcdZ"]);
    } finally {
      app.unmount();
    }
  });

  test("text and Backspaces in one read are replayed in order, where the cursor is", async () => {
    const { app, sent } = await chat();
    try {
      // ^H is a Backspace too.
      await app.press("ab\b\bcd");
      await app.press(KEYS.enter);
      // In the middle of the text: X typed, X and b deleted, Y typed.
      await app.pressAll("abc", KEYS.left, "X\x7f\x7fY", KEYS.enter);
      expect(sent).toEqual(["cd", "aYc"]);
    } finally {
      app.unmount();
    }
  });

  test("a tab goes in as two spaces, never as a raw tab", async () => {
    const { app, sent, box } = await chat();
    try {
      await app.press("a\tb");
      expect(box()).toEqual(["a  b"]);
      expect(app.frame()).not.toContain("\t");
      await app.press(KEYS.enter);
      expect(sent).toEqual(["a  b"]);
    } finally {
      app.unmount();
    }
  });

  test("every other control character is dropped", async () => {
    const { app, sent, box } = await chat();
    try {
      await app.press("x\x01y\x00z\u009bw");
      expect(box()).toEqual(["xyzw"]);
      await app.press(KEYS.enter);
      expect(sent).toEqual(["xyzw"]);
    } finally {
      app.unmount();
    }
  });

  test("a paste keeps its lines and is not sent; its control characters do not go in", async () => {
    const { app, sent, box } = await chat();
    try {
      // "two", two Backspaces, a tab, z, ^A, "!" on the second line.
      await app.press("one\ntwo\x7f\x7f\tz\x01!");
      expect(box()).toEqual(["one", "t  z!"]);
      expect(sent).toEqual([]);
      await app.press(KEYS.enter);
      expect(sent).toEqual(["one\nt  z!"]);
      // CRLF is one line break, as before.
      await app.pressAll("a\r\nb\r\nc", KEYS.enter);
      expect(sent[1]).toBe("a\nb\nc");
    } finally {
      app.unmount();
    }
  });

  test("a batched Enter sends what the keys in front of it left in the box", async () => {
    const { app, sent, box } = await chat();
    try {
      await app.press("hello");
      // Two Backspaces, p and Enter in ONE read: the typist fixed a typo and
      // sent, faster than the screen read.
      await app.press("\x7f\x7fp\r");
      expect(sent).toEqual(["help"]);
      expect(box()).toEqual([""]);
    } finally {
      app.unmount();
    }
  });

  test("a batched Backspace and Enter that leave nothing send nothing and empty the box", async () => {
    const { app, sent, box } = await chat();
    try {
      await app.press("a");
      await app.press("\x7f\r");
      expect(sent).toEqual([]);
      expect(box()).toEqual([""]);
      // The Backspace was not lost: the next message does not start with "a".
      await app.pressAll("b", KEYS.enter);
      expect(sent).toEqual(["b"]);
    } finally {
      app.unmount();
    }
  });
});
