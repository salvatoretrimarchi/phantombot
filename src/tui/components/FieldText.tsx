/**
 * A typed value, drawn with its cursor.
 *
 * One `<Text>` paragraph: the label, the text before the cursor, the cell under
 * it in inverse video, the rest, and an optional tail. Keeping it all inside a
 * single Text node is the point — sibling Text boxes in a row are each wrapped
 * by themselves, so a value longer than the line would break away from its own
 * label and the cursor cell would land on a different row than the text it sits
 * in. Here Ink wraps the whole paragraph once.
 *
 * The cursor is drawn ON a cell, never as a glyph inserted into the text (issue
 * #677), so moving it inside the text changes nothing about how the text wraps.
 * Past the end it is one blank cell, and on a line that is exactly full that
 * cell starts a new row: the chat prompt reserves a column for it, which a
 * component that must not know the terminal width cannot. A masked value is
 * drawn as dots and never as text.
 */

import React from "react";
import { Text } from "ink";

import { fieldParts, MASK } from "../lineEditor.ts";
import { graphemeCount, type PromptState } from "../promptBox.ts";

export function FieldText(props: {
  state: PromptState;
  masked?: boolean;
  /** Draw the cursor cell. Off for a field nothing is typing into right now. */
  cursor?: boolean;
  /** Drawn before the value, in the same paragraph (a label, the `› ` glyph). */
  prefix?: React.ReactNode;
  /** Drawn after the cursor cell; told whether the cursor is past the text. */
  suffix?: React.ReactNode | ((atEnd: boolean) => React.ReactNode);
  bold?: boolean;
  color?: string;
}): React.ReactElement {
  const { state, masked, bold, color } = props;
  const parts = fieldParts(state, { masked });
  const show = props.cursor !== false;
  const tail =
    typeof props.suffix === "function" ? props.suffix(parts.atEnd) : props.suffix;
  return (
    <Text>
      {props.prefix}
      {show ? (
        <>
          {parts.before ? (
            <Text bold={bold} color={color}>
              {parts.before}
            </Text>
          ) : null}
          <Text bold={bold} color={color} inverse>
            {parts.at}
          </Text>
          {parts.after ? (
            <Text bold={bold} color={color}>
              {parts.after}
            </Text>
          ) : null}
        </>
      ) : state.text ? (
        <Text bold={bold} color={color}>
          {masked ? MASK.repeat(graphemeCount(state.text)) : state.text}
        </Text>
      ) : null}
      {tail}
    </Text>
  );
}
