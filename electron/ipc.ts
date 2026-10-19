export const OPEN_WORKSPACE_CHANNEL = "cutfac:open-workspace";

export const REVEAL_PATH_CHANNEL = "cutfac:reveal-path";

export const SET_LOCALE_CHANNEL = "cutfac:set-locale";

/** Ask for a folder or file for agents to read, from an item's chat. */
export const PICK_PATH_CHANNEL = "cutfac:pick-path";

/** Undo and Redo from the app menu, for the board to route to a text field or the open item. */
export const EDIT_COMMAND_CHANNEL = "cutfac:edit-command";

/** Check a license key from the board's dialog and keep it to open the app and get updates. */
export const SET_LICENSE_KEY_CHANNEL = "cutfac:set-license-key";

/** Why the app is locked, if it is, for the board to show when it loads. */
export const LICENSE_LOCK_CHANNEL = "cutfac:license-lock";

/** The app locked or unlocked, for the board to show or hide its lock screen. */
export const LICENSE_LOCK_CHANGE_CHANNEL = "cutfac:license-lock-change";

/** Ask cutfac.com again about the saved key, from the lock screen. */
export const RECHECK_LICENSE_CHANNEL = "cutfac:recheck-license";

/** License Key… from the app menu, for the board to open its dialog. */
export const LICENSE_KEY_REQUEST_CHANNEL = "cutfac:license-key-request";
