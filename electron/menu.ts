import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
} from "electron";

import type { AppCommand, EditCommand } from "../web/src/desktop.ts";
import type { Messages } from "./messages.ts";

/** What the menu items do; the app wires them to its window and workspace. */
export interface MenuActions {
  /** The strings in the board's current language. */
  messages: Messages;
  /** Only the packaged app updates itself and checks a license key. */
  updatesEnabled: boolean;
  checkForUpdates: () => void;
  requestLicenseKey: () => void;
  openWorkspace: () => void;
  appCommand: (command: AppCommand) => void;
  editCommand: (command: EditCommand) => void;
  /** The dev build's Dev Panel; the released app has no Develop menu. */
  openDevTools?: (() => void) | undefined;
}

/** The standard menus, spelled out so every label can follow the board's language. */
export function menuTemplate(actions: MenuActions): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const t = actions.messages;
  const separator = { type: "separator" } as const;
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      role: "appMenu",
      submenu: [
        { role: "about", label: t.about },
        ...(actions.updatesEnabled
          ? [
              { label: t.checkForUpdates, click: actions.checkForUpdates },
              { label: t.licenseKey, click: actions.requestLicenseKey },
            ]
          : []),
        separator,
        { role: "services", label: t.services },
        separator,
        { role: "hide", label: t.hide },
        { role: "hideOthers", label: t.hideOthers },
        { role: "unhide", label: t.showAll },
        separator,
        { role: "quit", label: t.quit },
      ],
    });
  }

  template.push(
    {
      label: t.file,
      submenu: [
        {
          label: t.newVideo,
          accelerator: "CmdOrCtrl+N",
          click: () => actions.appCommand("newVideo"),
        },
        { label: t.openWorkspace, accelerator: "CmdOrCtrl+O", click: actions.openWorkspace },
        separator,
        isMac ? { role: "close", label: t.closeWindow } : { role: "quit", label: t.quit },
      ],
    },
    {
      label: t.edit,
      submenu: [
        // The board decides: undo the typing in a text field, or the last change to the item.
        { label: t.undo, accelerator: "CmdOrCtrl+Z", click: () => actions.editCommand("undo") },
        {
          label: t.redo,
          accelerator: isMac ? "Shift+CmdOrCtrl+Z" : "CmdOrCtrl+Y",
          click: () => actions.editCommand("redo"),
        },
        separator,
        { role: "cut", label: t.cut },
        { role: "copy", label: t.copy },
        { role: "paste", label: t.paste },
        ...(isMac ? [{ role: "pasteAndMatchStyle", label: t.pasteAndMatchStyle } as const] : []),
        { role: "delete", label: t.delete },
        { role: "selectAll", label: t.selectAll },
      ],
    },
    {
      label: t.view,
      submenu: [
        {
          label: t.commandPalette,
          accelerator: "CmdOrCtrl+K",
          click: () => actions.appCommand("palette"),
        },
        {
          label: t.toggleSidebar,
          accelerator: "CmdOrCtrl+B",
          click: () => actions.appCommand("toggleSidebar"),
        },
        separator,
        { label: t.board, accelerator: "CmdOrCtrl+1", click: () => actions.appCommand("board") },
        { label: t.learn, accelerator: "CmdOrCtrl+2", click: () => actions.appCommand("learn") },
        {
          label: t.templates,
          accelerator: "CmdOrCtrl+3",
          click: () => actions.appCommand("templates"),
        },
        separator,
        { role: "reload", label: t.reload },
        { role: "forceReload", label: t.forceReload },
        { role: "toggleDevTools", label: t.toggleDevTools },
        separator,
        { role: "resetZoom", label: t.actualSize },
        { role: "zoomIn", label: t.zoomIn },
        { role: "zoomOut", label: t.zoomOut },
        separator,
        { role: "togglefullscreen", label: t.fullScreen },
      ],
    },
    ...(actions.openDevTools
      ? [
          // Only in the dev build, so it isn't translated.
          {
            label: "Develop",
            submenu: [
              {
                label: "Dev Panel…",
                accelerator: "Alt+Shift+CmdOrCtrl+D",
                click: actions.openDevTools,
              },
            ],
          },
        ]
      : []),
    {
      role: "windowMenu",
      label: t.window,
      submenu: [
        { role: "minimize", label: t.minimize },
        { role: "zoom", label: t.zoom },
        ...(isMac
          ? [separator, { role: "front", label: t.front } as const]
          : [{ role: "close", label: t.closeWindow } as const]),
      ],
    },
  );

  return template;
}

/**
 * Text fields and selected text get the usual spelling fixes, Cut, Copy and Paste. Chromium leaves
 * out a right click the board answered with its own menu, such as a card's.
 */
export function showTextMenu(owner: BrowserWindow, params: ContextMenuParams, t: Messages): void {
  const { isEditable, selectionText, editFlags, dictionarySuggestions } = params;

  if (!isEditable && selectionText.trim() === "") return;

  const separator = { type: "separator" } as const;

  const template: MenuItemConstructorOptions[] = dictionarySuggestions
    .slice(0, 3)
    .map((word) => ({ label: word, click: () => owner.webContents.replaceMisspelling(word) }));

  if (template.length > 0) template.push(separator);

  if (isEditable) {
    template.push(
      { role: "cut", label: t.cut, enabled: editFlags.canCut },
      { role: "copy", label: t.copy, enabled: editFlags.canCopy },
      { role: "paste", label: t.paste, enabled: editFlags.canPaste },
      separator,
      { role: "selectAll", label: t.selectAll, enabled: editFlags.canSelectAll },
    );
  } else {
    template.push({ role: "copy", label: t.copy });
  }

  Menu.buildFromTemplate(template).popup({ window: owner });
}
