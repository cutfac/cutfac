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
- Content opts back in by wrapping what holds it (the message list, the guide, the checks panel)
  in `<SelectionArea>` (`web/src/components/selection-area.tsx`), not each line, so it selects like
  a document, its own headings included. To make an existing element the area instead of adding a
  `div`, pass it as `render`: `<SelectionArea render={<Card />}>`. Keep it off anything that acts
  on a click or a drag: a double-click there should open the thing, not highlight a word.
- Alerts, dialog descriptions and toasts opt in themselves with the `select-text` class
  (`web/src/components/ui/`), since they carry errors and often render outside any page.
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

## Cursor and hover

Native apps keep the arrow over what you click: a button, a tab, a sidebar row, a menu item, a card.
The hand means one thing there, a link to a page or a document, usually set in text. A hand over
every button reads as a web page.

So the cursor doesn't tell people what they can click; the hover does. Everything that acts on a
click changes when the pointer reaches it. The cursor changes only where the pointer does something
other than click: drag a thing, select text, aim at a spot, resize an edge.

| Cursor              | Over                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Arrow               | Buttons, toggles, tabs, menu items, sidebar rows, the cards and tiles that open on a click, and links outside of prose |
| Hand                | Links inside prose (`.typeset`: chat messages, guides), and that prose's disclosure toggles                            |
| Text                | Text that selects, text fields, and the timeline, where a drag marks a range                                           |
| Crosshair           | The stage, where a drag marks a spot in the frame                                                                      |
| Grab, then grabbing | What moves with a drag: board cards, the editor's panel grips, a drawer's handle                                       |
| Resize              | Edges that resize, such as the sidebar's                                                                               |
| Zoom in             | An image that opens full size, such as a check's sheet of frames                                                       |
| Not allowed         | Disabled fields. A disabled button fades instead and lets the pointer through.                                         |

How it is built:

- `a` is `cursor: default` (`web/src/styles.css`), and `web/src/typeset.css` gives links in prose
  their hand back. Tailwind v4 already leaves buttons on the arrow. Don't add `cursor-pointer`.
- The shared controls in `web/src/components/ui/` already change on hover: buttons, sidebar rows,
  menu items. Build with them and the hover comes along.
- Something clickable built by hand, such as a card or a tile, tints with `bg-muted/50`, the ghost
  button's hover. Cards and tiles also lift with `shadow-md`.
- The same tint shows under keyboard focus (`focus-visible:`, or `has-focus-visible:` when the focus
  lands on a link inside) and while the thing's menu is open (`data-popup-open:`). The keyboard and
  a right click then show what the pointer would.
- A component from `web/src/components/ui/` owns its colors, and the lint rejects a tint passed to
  it. Tint a plain wrapper instead: the gallery tile's wrapper reaches 8px past the tile, and the
  board card's wrapper tints the card inside it with `hover:*:bg-muted/50`.
- Where a special cursor already names what a click does, it can stand in for the tint, as the zoom
  cursor does on a check's image.

Sources:

- Apple, Human Interface Guidelines, [Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices):
  on macOS the pointing hand means the content under it links to a webpage, a document or another
  item.
- Microsoft, [Mouse and pointers](https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-mouse):
  the hand is for text and graphic links only. Command buttons don't need it, and secondary
  controls may show that they're clickable on hover.
- Tailwind CSS, [Upgrade guide](https://tailwindcss.com/docs/upgrade-guide#buttons-use-the-default-cursor):
  v4 moved buttons to the default cursor, as the browser has it.
- Radix Themes, [Cursors](https://www.radix-ui.com/themes/docs/theme/cursors): controls that don't
  link to another page keep the arrow by default; disabled ones get an explicit disabled cursor.
- Adam Silver, [Buttons shouldn't have a hand cursor](https://adamsilver.io/blog/buttons-shouldnt-have-a-hand-cursor/):
  the hand marks links, and a button already looks clickable.

## Color

The board is gray, with one color: the gold of the logo, `brand` in `web/src/styles.css`. Because
nothing else is colored, gold always means "this is for you": do it, or look at it.

- **Gold (`brand`)**: the primary action (a default `Button`: send, save, create, keep), what the
  user marked on the video (`selection`, an alias of `brand`), and what waits for them (a request
  that needs an answer, a video to review, versions to pick from). Keep to one gold button per
  screen or dialog; the other buttons are `outline`, `secondary` or `ghost`. Rows that each offer
  the same first step, such as connecting each agent in Settings, may each have theirs. A control
  that is used over and over, such as play, is not the primary action.
- **Gray when it can't run**: a primary action that can't run yet goes gray (`muted`), so a gold
  button is always one to press.
- **Gray**: everything else, including the agent at work. Work in progress pulses or spins in
  `muted-foreground`; it turns gold only when the result is the user's to look at.
- **Red (`destructive`)**: failures and deleting, nothing else.
- **Blue (`dock`)**: where a section being dragged can go. It shows only during the drag.

`primary` stays near-black (near-white in dark mode) for the small controls that use it, such as
switches, progress and badges, so they don't compete with the gold.

## Shape

Shapes follow the Codex app and Aside. Buttons, select triggers, toggles and segmented controls are
softly squared (`rounded-2xl`), as their settings draw them. Only what sits among the chat is round:
the composer's buttons and the chat's chips are pills (`Button pill`), and its icon buttons are
circles. Fields stay softly squared, and cards and panels keep their larger radius.

Tabs and other segmented choices have no box around them: only the picked one is filled, and the
rest are quiet text. Controls in a title bar are ghosts that tint under the pointer, as Aside's are;
the one main action keeps its fill.

A settings page groups its rows as both apps do: each group's name and what it is for sit above a
card that holds only the rows (`Section` in `components/page.tsx`), split by hairlines
(`Item variant="row"`).
