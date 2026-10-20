export const OPEN_WORKSPACE_CHANNEL = "cutfac:open-workspace";

export const REVEAL_PATH_CHANNEL = "cutfac:reveal-path";

export const SET_LOCALE_CHANNEL = "cutfac:set-locale";

/** Ask for a folder or file for agents to read, from an item's chat. */
export const PICK_PATH_CHANNEL = "cutfac:pick-path";

/** Undo and Redo from the app menu, for the board to route to a text field or the open item. */
export const EDIT_COMMAND_CHANNEL = "cutfac:edit-command";

/** Check a license key from the board's dialog and keep it to unlock the paid plan. */
export const SET_LICENSE_KEY_CHANNEL = "cutfac:set-license-key";

/** The paid plan unlocked or ran out, for the board to show the plan again. */
export const LICENSE_CHANGE_CHANNEL = "cutfac:license-change";

/** The board asks for its license key dialog, as License Key… in the app menu does. */
export const OPEN_LICENSE_KEY_CHANNEL = "cutfac:open-license-key";

/** License Key… from the app menu, or asked for by the board, for the board to open its dialog. */
export const LICENSE_KEY_REQUEST_CHANNEL = "cutfac:license-key-request";
