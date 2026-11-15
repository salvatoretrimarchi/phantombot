/**
 * The bytes behind a key — what lets Delete delete and Backspace backspace.
 *
 * Ink reports the Backspace key (`0x7f`) and the Delete key (`ESC[3~`) the same
 * way: `key.delete`, empty `input`. The chat box therefore treated Delete as a
 * Backspace, and the identity editor treated Backspace as a forward delete.
 * `useRawKey` reads the sequence off Ink's own input event instead, and these
 * tests pin the two things that make that sound: the sequence is the one that
 * produced the key, and it is already there when the key handler runs.
 *
 * If a future Ink stops emitting `input` on `internal_eventEmitter`, the first
 * test here fails with an empty sequence — which is the point of having it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { Text, useInput } from "ink";

import { useRawKey } from "../src/tui/useRawKey.ts";
import { useStableInput } from "../src/tui/useStableInput.ts";
import { KEYS as K, mountInk, type Mounted } from "./helpers/inkMount.tsx";

let open: Mounted[] = [];
afterEach(() => {
  for (const m of open) m.unmount();
  open = [];
});

/** `\x1b[3~` → "ESC [ 3 ~": control bytes made readable in a failure message. */
const spell = (raw: string) =>
  [...raw]
    .map((c) => {
      const n = c.charCodeAt(0);
      if (n === 0x1b) return "ESC";
      if (n < 0x20 || n === 0x7f) return `0x${n.toString(16).padStart(2, "0")}`;
      return c;
    })
    .join(" ");

function flags(key: { delete: boolean; backspace: boolean }): string {
  return key.delete ? "delete" : key.backspace ? "backspace" : "-";
}

describe("useStableInput hands the handler the bytes of the key", () => {
  function probe() {
    const log: string[] = [];
    function Probe() {
      useStableInput((_input, key, raw) => {
        log.push(`${spell(raw)} → ${flags(key)}`);
      });
      return <Text>probe</Text>;
    }
    const app = mountInk(<Probe />);
    open.push(app);
    return { app, log };
  }

  test("Backspace and Delete are the same flag but different bytes", async () => {
    const { app, log } = probe();
    await app.press(K.backspace);
    await app.press(K.deleteKey);
    await app.press(K.ctrlH);
    expect(log).toEqual(["0x7f → delete", "ESC [ 3 ~ → delete", "0x08 → backspace"]);
  });

  test("two keys in one read are two events, each with its own bytes", async () => {
    const { app, log } = probe();
    await app.press(`${K.deleteKey}${K.backspace}${K.deleteKey}`);
    expect(log).toEqual([
      "ESC [ 3 ~ → delete",
      "0x7f → delete",
      "ESC [ 3 ~ → delete",
    ]);
  });

  test("modified keys carry their full sequence", async () => {
    const { app, log } = probe();
    await app.press(K.ctrlDelete);
    await app.press(K.altBackspace);
    await app.press(K.kittyCtrlBackspace);
    expect(log).toEqual([
      "ESC [ 3 ; 5 ~ → delete",
      "ESC 0x7f → delete",
      "ESC [ 1 2 7 ; 5 u → delete",
    ]);
  });
});

describe("useRawKey beside a plain useInput (the chat screen's shape)", () => {
  test("the sequence is current even when the handler is re-subscribed every render", async () => {
    // The chat screen's `useInput` takes an inline closure, so Ink removes and
    // re-adds its listener on every render — here, on every key, because each
    // one changes state. The raw listener is registered once, FIRST, so it is
    // still ahead of the handler each time.
    const log: string[] = [];
    function Chatlike() {
      const [count, setCount] = useState(0);
      const raw = useRawKey();
      useInput((_input, key) => {
        log.push(`${spell(raw.current)} → ${flags(key)}`);
        setCount(count + 1);
      });
      return <Text>{`keys: ${count}`}</Text>;
    }
    const app = mountInk(<Chatlike />);
    open.push(app);
    for (const key of [K.deleteKey, K.backspace, K.deleteKey, K.backspace, K.deleteKey]) {
      await app.press(key);
    }
    expect(app.frame()).toContain("keys: 5");
    expect(log).toEqual([
      "ESC [ 3 ~ → delete",
      "0x7f → delete",
      "ESC [ 3 ~ → delete",
      "0x7f → delete",
      "ESC [ 3 ~ → delete",
    ]);
  });
});
