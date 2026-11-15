/**
 * The single-value input screen.
 *
 * The last typed answer in the app — setting a credential — still dropped out
 * to a `@clack` panel: renderer suspended, alternate screen left, question
 * drawn on the user's normal terminal with no header, no footer and no `esc`.
 * That is the break in the design language the confirm screen already closed
 * for yes/no questions, so a typed value closes it the same way: a SCREEN,
 * with the app's own chrome and the app's own keys.
 *
 * `masked` is for credentials. The value is never rendered back — only its
 * length, as dots — because a settings screen that echoes a secret puts it in
 * the scrollback the user reached for the vault to avoid.
 *
 * Cancel is a first-class answer, exactly as it was under clack: `esc`
 * resolves `undefined`, NEVER the empty string. `""` would be written to the
 * vault and erase a credential the user only meant to look at.
 */

import React from "react";

import { useStableInput } from "../useStableInput.ts";
import { Box, Text } from "ink";

import { FieldText } from "../components/FieldText.tsx";
import { Frame } from "../components/Frame.tsx";
import { badge, theme } from "../theme.ts";
import { feedField, useTextField } from "../useTextField.ts";

export interface AskRequest {
  title: string;
  /**
   * Guidance block under the title — why the question matters, examples.
   * A plain string renders dim (the legacy look); a ReactNode renders as-is
   * so flows can compose styled prose and example boxes.
   */
  description?: string | React.ReactNode;
  hint?: string;
  masked?: boolean;
  initial?: string;
  /**
   * When true, an empty box IS an answer — it resolves `""`.
   *
   * The harness flow needs this: "blank = keep the current key" and "blank =
   * no model override" are real answers there, and refusing them would leave
   * the user with no way past the question except typing something they do not
   * mean. Off by default, because for a credential `""` erases what it names.
   */
  allowEmpty?: boolean;
}

export function AskScreen(props: {
  request: AskRequest;
  onAnswer: (value: string | undefined) => void;
  /**
   * Drop the `esc Back` footer entry — for flows whose first step has no
   * screen behind it (genuine first run, wizard resume). With `onQuit` the
   * app-wide `ctrl+q Quit` is advertised in its place: on genuine first run the
   * wizard IS the app, so there must be a way out — a footer with only
   * `Save` hides a working key, and a key that silently does nothing is
   * worse than either.
   */
  noBack?: boolean;
  /** When `noBack`, ctrl+q exits the app (the app-wide quit), esc does nothing.
   *  Must be exactly app exit and nothing else: App.tsx already handles ctrl+q
   *  globally, so both handlers fire — this one is only safe because it does
   *  the same thing. Anything else ("leave the wizard, keep the app") would
   *  run alongside the global quit, which wins. */
  onQuit?: () => void;
}): React.ReactElement {
  const { title, description, hint, masked, initial, allowEmpty } = props.request;
  // The value AND its cursor. `field.ref` is written synchronously on every
  // keystroke: several chunks can arrive before React re-renders, and a
  // closure-read value is one render stale — the same bug that once named a
  // persona after only its last few letters.
  const field = useTextField(initial ?? "");

  const submit = (text: string) => {
    const trimmed = text.trim();
    // An empty box is not an answer — unless the caller said it is. Treating
    // it as one by default would clear the very setting the user opened this
    // screen to fill in.
    if (!trimmed && !allowEmpty) return;
    props.onAnswer(trimmed);
  };

  useStableInput((char, key, raw) => {
    if (props.noBack && props.onQuit && key.ctrl && char === "q") {
      return props.onQuit();
    }
    if (key.escape) return props.onAnswer(undefined);
    if (key.return) return submit(field.ref.current.text);
    // Everything else is the shared line editor: ←/→, Home/End, Delete and
    // Backspace, word moves, typed text and pastes land AT THE CURSOR. This
    // screen used to append and `slice(0, -1)`, so a typo in the middle of a
    // base URL could only be fixed by deleting the tail.
    const result = feedField(field, char, key, { raw });
    if (result.submit !== undefined) submit(result.submit);
  });

  return (
    <Frame
      title={["configure", masked ? "secret" : "value"]}
      footer={[
        { icon: badge.save, key: "↵", label: "Save" },
        ...(props.noBack
          ? props.onQuit
            ? [{ icon: badge.quit, key: "ctrl+q", label: "Quit" }]
            : []
          : [{ icon: badge.back, key: "esc", label: "Back" }]),
      ]}
    >
      <Box>
        <Text bold>{title}</Text>
      </Box>
      {description ? (
        // Component descriptions (e.g. ExampleBox) carry their own bottom
        // margin — adding ours too renders a double gap above the hint.
        <Box
          marginBottom={typeof description === "string" ? 1 : 0}
          flexDirection="column"
        >
          {typeof description === "string" ? (
            <Text color={theme.dim}>{description}</Text>
          ) : (
            description
          )}
        </Box>
      ) : null}
      {/* Hint sits just above the input — the eye lands here when it matters
          (validation errors, format rules), and the title stays first on
          screen. Rendering it above the title put stray guidance at the very
          top, which read as orphaned text. */}
      {hint ? (
        <Box marginBottom={1}>
          <Text color={theme.dim}>{hint}</Text>
        </Box>
      ) : null}
      <Box>
        {/* One paragraph, label and value together: a value longer than the
            line wraps with its own prefix, and the cursor cell is drawn on the
            character it sits on, so moving it inside the text does not re-wrap
            it. Past the end it takes one blank cell of its own, which starts a
            new row when the line is exactly full. */}
        <FieldText
          state={field.state}
          masked={masked}
          prefix={<Text color={theme.accent}>{"› "}</Text>}
        />
      </Box>
    </Frame>
  );
}
