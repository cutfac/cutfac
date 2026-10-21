# Board UI

The board runs as a Mac app first, so it follows desktop conventions where the web's habits differ.

## Text selection

Native apps don't let a drag highlight their own words. A button, a sidebar row or a heading is
something you click, not something you copy, and a highlight across it reads as a web page. What
people read and might paste somewhere else does select: a message, an error, a path.

The test for any text is whether someone would paste it into another app: a bug report, a chat, a
terminal, a search box. If they would, it selects. If not, it doesn't.

| Selects                                                                               | Doesn't select                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Chat messages, both the user's and the agent's, and the steps an agent run reports    | The sidebar, the title bar, toolbars, tabs and menus                                              |
| Guides and other long text: Learn, a template's details, a video's checks and details | Labels on buttons, badges, toggles and menu items                                                 |
| Errors, warnings and alert details                                                    | Page titles, field labels and column headers                                                      |
| Paths, links, IDs, timecodes and commands shown as values in a detail view            | Cards, rows and tiles that open, select or drag on click (board cards, the gallery, the timeline) |
| Empty states and hints that carry a command or a path to copy                         | Placeholders, decorative text and counts that only label something                                |
| Text fields, always                                                                   |                                                                                                   |

How it is built:

- `body` is `select-none` (`web/src/styles.css`), so new UI starts out as chrome.
- Content opts back in with `select-text` on the wrapper that holds it (the message list, the
  guide, the checks panel), not on each line, so it selects like a document, its own headings
  included. Keep it off anything that acts on a click or a drag: a double-click there should open
  the thing, not highlight a word.
- Alerts, dialog descriptions and toasts opt in themselves (`web/src/components/ui/`), since they
  carry errors and often render outside any page.
- Controls inside a selectable region stay unselectable. The shared buttons, badges and menu items
  already are.
- Inputs, text areas and contenteditable elements always select and edit; they need nothing.
- The pointer stays an arrow over chrome. Chromium shows the text cursor only over text that
  selects, so the cursor itself tells people what they can copy.
- Select All in a text field takes that field. Anywhere else it takes the selectable text on screen
  and leaves the chrome out. It isn't scoped to one region: Chromium lacks `user-select: contain`,
  and that alone isn't worth a script.
- When text is useful to copy but sits in something that acts on a click, such as a file name on a
  card, offer Copy in its menu instead of making it selectable.

`user-select: none` only changes how the board feels. It doesn't protect anything: the text is
still in the page.

Sources:

- Apple, Human Interface Guidelines, [Labels](https://developer.apple.com/design/human-interface-guidelines/labels):
  make useful label text, such as an error message or an address, selectable.
- Microsoft, [Selecting text and images](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-textselection):
  buttons, labels and logos don't select; text in content controls does.
- VS Code's workbench CSS ([style.css](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/media/style.css)):
  the body is unselectable, and hovers, notifications, dialog details and chat opt back in.
- Evil Martians, [How to make absolutely any app look like a macOS app](https://evilmartians.com/chronicles/how-to-make-absolutely-any-app-look-like-a-macos-app):
  anything people might want to select should select, and nothing else.
- Electron, [Custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions):
  window drag regions conflict with text selection.
- MDN, [user-select](https://developer.mozilla.org/en-US/docs/Web/CSS/user-select): how `auto`
  inherits `none` from its parent and how an explicit `text` opts back in.
