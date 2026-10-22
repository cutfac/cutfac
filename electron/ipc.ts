export const OPEN_WORKSPACE_CHANNEL = "cutfac:open-workspace";

export const REVEAL_PATH_CHANNEL = "cutfac:reveal-path";

export const SET_LOCALE_CHANNEL = "cutfac:set-locale";

/** Ask for a folder or file for agents to read, from an item's chat. */
export const PICK_PATH_CHANNEL = "cutfac:pick-path";

/** Undo and Redo from the app menu, for the board to route to a text field or the open item. */
export const EDIT_COMMAND_CHANNEL = "cutfac:edit-command";

/** The palette, a new video, the sidebar or a page from the app menu, for the board to open. */
export const APP_COMMAND_CHANNEL = "cutfac:app-command";

/** Check a license key from the board's dialog and keep it to unlock the paid plan. */
export const SET_LICENSE_KEY_CHANNEL = "cutfac:set-license-key";

/** The paid plan unlocked or ran out, for the board to show the plan again. */
export const LICENSE_CHANGE_CHANNEL = "cutfac:license-change";

/** The board asks for its license key dialog, as License Key… in the app menu does. */
export const OPEN_LICENSE_KEY_CHANNEL = "cutfac:open-license-key";

/** License Key… from the app menu, or asked for by the board, for the board to open its dialog. */
export const LICENSE_KEY_REQUEST_CHANNEL = "cutfac:license-key-request";

/** Drag a workspace file out of the board, to drop a copy of it in Finder or another app. */
export const START_DRAG_CHANNEL = "cutfac:start-drag";

/** Every agent CLI as found on this computer, for the first launch's agent step. */
export const AGENTS_CHANNEL = "cutfac:agents";

/** Install, update or sign in an agent CLI with the fix its last check named. */
export const FIX_AGENT_CHANNEL = "cutfac:fix-agent";

/** A line a running fix printed, for the agent step to show. */
export const FIX_OUTPUT_CHANNEL = "cutfac:fix-output";

/** Whether macOS lets the app read every file. */
export const FULL_DISK_ACCESS_CHANNEL = "cutfac:full-disk-access";

/** Open the Full Disk Access list in System Settings, with the helper window beside it. */
export const OPEN_ACCESS_SETTINGS_CHANNEL = "cutfac:open-access-settings";

/** Full Disk Access was granted while System Settings was open. */
export const ACCESS_GRANTED_CHANNEL = "cutfac:access-granted";

/** Drag the app itself out of the helper window, into the Full Disk Access list. */
export const START_APP_DRAG_CHANNEL = "cutfac:start-app-drag";

/** The app's icon, for the helper window to show as the thing to drag. */
export const APP_ICON_CHANNEL = "cutfac:app-icon";

/** The folder the workspace step suggests. */
export const DEFAULT_FOLDER_CHANNEL = "cutfac:default-folder";

/** Ask for another folder for the workspace. */
export const CHOOSE_FOLDER_CHANNEL = "cutfac:choose-folder";

/** Make the workspace folder and open the board on it. */
export const CREATE_WORKSPACE_CHANNEL = "cutfac:create-workspace";
