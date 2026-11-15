/**
 * Mount an Ink screen on a fake terminal and press keys as raw bytes.
 *
 * What a user types reaches the app as bytes on stdin, so that is what a test
 * sends: `"\x7f"` for Backspace, `"\x1b[3~"` for Delete, `"\x1b[1;5D"` for
 * Ctrl-←. Going through the real Ink input path (not calling a handler) is the
 * point: the failures this guards against — Delete read as Backspace, a batched
 * chunk typed as text — live between the bytes and the handler.
 *
 * `marked()` returns the frame with the cursor made visible as `⟦x⟧`, which is
 * how a test sees WHERE the cursor is. Inverse video is the only thing that
 * draws it, so the colour level is forced on for the life of a suite
 * (`forceColor`), as `tests/tui-bars.test.tsx` does.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type React from "react";
import { render } from "ink";
import inkChalk from "../../node_modules/ink/node_modules/chalk/source/index.js";

import { stripAnsi } from "./ansi.ts";

const ESC = "\u001b";

/** Key bytes, spelled as escapes: a raw control byte is invisible in review. */
export const KEYS = {
  enter: "\r",
  esc: `${ESC}`,
  backspace: "\x7f",
  /** ^H — what some terminals send for Ctrl-Backspace. */
  ctrlH: "\x08",
  deleteKey: `${ESC}[3~`,
  ctrlDelete: `${ESC}[3;5~`,
  altDelete: `${ESC}[3;3~`,
  /** Alt as an Esc prefix in front of the Delete key's own sequence. */
  altDeleteEsc: `${ESC}${ESC}[3~`,
  altBackspace: `${ESC}\x7f`,
  /** Kitty protocol: CSI codepoint ; modifiers u (5 = ctrl, 3 = alt). */
  kittyBackspace: `${ESC}[127u`,
  kittyCtrlBackspace: `${ESC}[127;5u`,
  left: `${ESC}[D`,
  right: `${ESC}[C`,
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  /** Application cursor mode, which the TUI switches on (terminal.ts). */
  leftApp: `${ESC}OD`,
  rightApp: `${ESC}OC`,
  home: `${ESC}[H`,
  end: `${ESC}[F`,
  homeTilde: `${ESC}[1~`,
  endTilde: `${ESC}[4~`,
  ctrlLeft: `${ESC}[1;5D`,
  ctrlRight: `${ESC}[1;5C`,
  altLeft: `${ESC}[1;3D`,
  altRight: `${ESC}[1;3C`,
  altB: `${ESC}b`,
  altF: `${ESC}f`,
  altD: `${ESC}d`,
  ctrlA: "\x01",
  ctrlB: "\x02",
  ctrlD: "\x04",
  ctrlE: "\x05",
  ctrlF: "\x06",
  ctrlU: "\x15",
  ctrlW: "\x17",
  pageUp: `${ESC}[5~`,
  pageDown: `${ESC}[6~`,
} as const;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Turn colour on for a suite, and put it back afterwards. */
export function forceColor(): { restore: () => void } {
  const before = inkChalk.level;
  inkChalk.level = 3;
  return {
    restore: () => {
      inkChalk.level = before;
    },
  };
}

export interface Mounted {
  /** The latest frame, colour stripped. */
  frame: () => string;
  /** The latest frame with the cursor cell drawn as `⟦x⟧`. Needs `forceColor`. */
  marked: () => string;
  /** Send bytes as ONE chunk, then wait for Ink to settle. */
  press: (bytes: string, wait?: number) => Promise<void>;
  /** Send each item as its own chunk. */
  pressAll: (...chunks: string[]) => Promise<void>;
  unmount: () => void;
}

export function mountInk(
  node: React.ReactElement,
  size: { columns?: number; rows?: number } = {},
): Mounted {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: () => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  const frames: string[] = [];
  const stdout = new EventEmitter() as EventEmitter & {
    columns: number;
    rows: number;
    write: (c: string) => void;
  };
  stdout.columns = size.columns ?? 100;
  stdout.rows = size.rows ?? 40;
  stdout.write = (c: string) => void frames.push(c);
  const instance = render(node, {
    stdin: stdin as never,
    stdout: stdout as never,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: true,
  });
  const press = async (bytes: string, wait = 60) => {
    stdin.write(bytes);
    // A lone ESC is held back by Ink until its disambiguation timer runs, so
    // a key that starts with one needs the longer wait.
    await sleep(bytes.startsWith(ESC) ? Math.max(wait, 90) : wait);
  };
  return {
    frame: () => stripAnsi(frames.at(-1) ?? ""),
    marked: () =>
      stripAnsi(
        (frames.at(-1) ?? "").replace(
          // eslint-disable-next-line no-control-regex
          /\u001b\[7m([\s\S]*?)\u001b\[27m/g,
          (_all, inner: string) => `⟦${stripAnsi(inner)}⟧`,
        ),
      ),
    press,
    pressAll: async (...chunks) => {
      for (const chunk of chunks) await press(chunk);
    },
    unmount: () => instance.unmount(),
  };
}
