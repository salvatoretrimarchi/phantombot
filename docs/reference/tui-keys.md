# TUI keys

Keys in the interactive TUI (`phantombot` in a terminal). The chat prompt and
every one-line box follow the same Emacs/readline-style editing keys: every
value the app asks for — a base URL, an API key, a model id, a persona name —
plus the provider/model search boxes, the log filter and the
type-the-name-to-confirm box. (The identity file editor has its own keys,
further down.) In the chat prompt and the log filter, Home/End (and
PgUp/PgDn) scroll what is behind the box instead, so the line ends are
`Ctrl-A` / `Ctrl-E` there.

## Editing a value

| Key | Action |
| --- | --- |
| `←` / `→`, `Ctrl-B` / `Ctrl-F` | One character back / forward. |
| `Alt-B` / `Alt-F`, `Alt-←` / `Alt-→`, `Ctrl-←` / `Ctrl-→` | To the start of the previous word / the end of the next word (in the chat prompt, across lines). |
| `Home` / `End` | To the start / end of the value. In the chat prompt and the log filter these scroll instead; use `Ctrl-A` / `Ctrl-E`. |
| `Ctrl-A` / `Ctrl-E` | Start / end of the current line. In the chat prompt, pressed again: start / end of the whole input. |
| `↑` / `↓`, `Ctrl-P` / `Ctrl-N` | Chat prompt only: one row up / down, as drawn (wrapped rows count). On the first / last row they scroll the transcript instead. In every other box `↑` / `↓` never edit: they pick a row where there is a list. |
| `Backspace` | Delete the character before the cursor. |
| `Delete`, `Ctrl-D` | Delete the character under the cursor. |
| `Alt-Backspace`, `Ctrl-Backspace` / `Alt-D`, `Alt-Delete`, `Ctrl-Delete` | Delete back to where `Alt-B` lands / forward to where `Alt-F` lands. |
| `Ctrl-W` | Delete back to the previous space, so a path or URL goes in one press. |
| `Ctrl-U` | Delete back to the start of the line. In the chat prompt, pressed again at the line start: everything before the cursor. |
| `Enter` | Accept: save the value, take the highlighted row or choice, or send in the chat prompt. |
| `Esc` | Cancel a question or picker; nothing is changed. In the log filter it leaves the box and keeps the text. |

`Ctrl-Backspace` is its own key only where the terminal reports it as one (the
kitty keyboard protocol); elsewhere it is usually indistinguishable from
`Backspace`.

Pasting inserts at the cursor, not at the end. In a question, a newline inside
a paste is `Enter`: the text before it is saved. In the search boxes, the log
filter and the confirm box a newline is a space, except those at the very end
of the paste, which are dropped. A tab becomes one space in all of them. In the
chat prompt, text that arrives with line breaks inside it stays in the box for
you to review, a tab becomes two spaces, and dropped image paths become
attachments (see Images). A single line that arrives with one newline at its
end, while the cursor is at the end of the box, is sent: the app cannot tell it
from that line typed and `Enter` pressed in the same read.

The app cannot tell a paste from keys that arrive together, so in all of these
boxes the bytes a `Backspace` press can send (`0x7f`, `0x08`) delete a
character wherever they arrive: several presses delivered in one read each
delete one. Any other control character inside typed or pasted text, apart
from the newline and the tab above, is dropped.

The chat prompt adds:

| Key | Action |
| --- | --- |
| `Shift-Enter`, `Ctrl-Enter`, `Alt-Enter` | New line, in terminals that report modifiers (kitty protocol, CSI-u). |
| `Ctrl-J` | New line, in every terminal. |
| `Tab` | Complete a half-typed slash command. |

A word is a run of letters, digits and combining marks. Whitespace,
punctuation, newlines and emoji separate words.

Deleted text is gone: there is no kill ring, so `Ctrl-Y` does nothing.
`Ctrl-K` opens the key inspector in the chat rather than deleting to the end of
the line.

`Backspace` and `Delete` are told apart by the bytes the terminal sends
(`0x7f` against `ESC [ 3 ~`), because Ink reports both as the same key. A
terminal that sends `ESC [ 3 ~` for its Backspace key will delete forward;
`Ctrl-K` in the chat shows what your terminal actually sends.

The cursor is drawn as the character under it in inverse video, or as a solid
cell at the end of the text. In the chat prompt, moving it never re-wraps the
text. A secret is drawn as dots, one per character, and the cursor sits on a
dot.

## The identity file editor

The Identity row of a persona's Configure screen opens one of its files
(`SOUL.md`, `IDENTITY.md`, …) in a full-screen editor, not a one-line box.
`←` `→` `↑` `↓` move, `Home` / `End` go to either end of the line, `PgUp` /
`PgDn` move a screenful, `Enter` starts a new line and `Tab` inserts two
spaces. `Backspace` deletes the character before the cursor and `Delete` the
one under it, read from the bytes like everywhere else. A paste keeps its
lines and a tab in it becomes two spaces; the Backspace bytes and the other
control characters in typed or pasted text are treated as in the boxes above,
so they are not typed into the file. `Ctrl-S` saves; `Esc` goes back, and asks
first when there are unsaved changes.

## Transcript and app

| Key | Action |
| --- | --- |
| Scroll wheel / trackpad | Scroll the transcript, the same as `↑` / `↓`. |
| `PgUp` / `PgDn` | Scroll the transcript one page. |
| `Shift-↑` / `Shift-↓` | Scroll the transcript one line. |
| `Home` / `End` | Jump to the top / the live end of the transcript. |
| `Ctrl-C` | Stop the running turn (the same as `/stop`). It never quits. |
| `Ctrl-Q` | Quit, the same as typing `/quit` (or `/q`, `/exit`). The phantombot service keeps running. |
| `Ctrl-S` | Open settings. |
| `Ctrl-K` | Toggle the key inspector: the raw bytes the terminal sent. |

While the transcript is scrolled away from the live end, `↑` / `↓` keep
scrolling it until it is back at the bottom.

The app never captures the mouse, so click-drag selection and copy stay the
terminal's own. The wheel works because most terminals turn it into `↑` / `↓`
on the alternate screen. macOS Terminal.app only does that while the
application has switched the cursor keys to application mode, as `less` and
`vim` do, so the TUI switches that mode on while it runs and off again on exit.

## Images

Drag an image file from Finder, or a screenshot thumbnail, onto the window. The
chat box shows it as `[Image #1]`, `[Image #2]`, … at the cursor, and you can
type around it. When you send, each image whose token is still in the text is
attached, so deleting the token removes the image. The path shows for a
moment and turns into the token once the drop is complete. PNG, JPEG, GIF and
WebP up to 10 MB are accepted. Anything else you drop, or a path to a file that
isn't there, is pasted as ordinary text.

The image is copied into the conversation's inbox as soon as you drop it, so a
screenshot thumbnail that disappears afterwards still gets sent. The model
receives the copy's path as an `[attached: …]` line, the same way a photo sent
over Telegram arrives.

## Alt on macOS: Option as Meta

The `Alt` bindings need the terminal to send Alt as an Esc prefix. Most Linux
and Windows terminals do this by default. On macOS, Option types characters
instead (`Option-B` is `∫`, `Option-F` is `ƒ`) until you change it:

- **iTerm2:** Settings → Profiles → Keys → General → *Left Option key*:
  `Esc+`. Set it on the profile the window actually uses (Session → Edit
  Session…); the right Option key has its own setting.
- **Terminal.app:** Settings → Profiles → Keyboard → *Use Option as Meta key*.

`Ctrl-K` shows what arrives: with Option set up as Meta, `Option-B` shows as
`\u001bb`; without it, as `∫`.
