export const OPEN_WORKSPACE_CHANNEL = "cutfac:open-workspace";

/** The workspaces in the app's folder. */
export const WORKSPACES_CHANNEL = "cutfac:workspaces";

/** Open a workspace in the app's folder by its name. */
export const SWITCH_WORKSPACE_CHANNEL = "cutfac:switch-workspace";

/** Make a workspace in the app's folder by its name, and open it. */
export const NEW_WORKSPACE_CHANNEL = "cutfac:new-workspace";

export const REVEAL_PATH_CHANNEL = "cutfac:reveal-path";

export const SET_LOCALE_CHANNEL = "cutfac:set-locale";

/** The language the app saved, read as a page starts so it opens in that language. */
export const LOCALE_CHANNEL = "cutfac:locale";

/** Ask for a folder or file for agents to read, from an item's chat. */
export const PICK_PATH_CHANNEL = "cutfac:pick-path";

/** Undo and Redo from the app menu, for the board to route to a text field or the open item. */
export const EDIT_COMMAND_CHANNEL = "cutfac:edit-command";

/** The palette, a new video, the sidebar or a page from the app menu, for the board to open. */
export const APP_COMMAND_CHANNEL = "cutfac:app-command";

/** A `cutfac://new` link came, for the board to take its prompt into a new video. */
export const NEW_VIDEO_LINK_CHANNEL = "cutfac:new-video-link";

/** The last link's prompt and who linked to it, once; none when it was taken or none came. */
export const TAKE_NEW_VIDEO_LINK_CHANNEL = "cutfac:take-new-video-link";

/** Whether a link's prompt waits for the board, without taking it, for the first launch to say so. */
export const NEW_VIDEO_LINK_WAITING_CHANNEL = "cutfac:new-video-link-waiting";

/** What waits for the user, for the Dock badge and a notification when an agent asks. */
export const ATTENTION_CHANNEL = "cutfac:attention";

/** Check a license key from the board's dialog and keep it to unlock the paid plan. */
export const SET_LICENSE_KEY_CHANNEL = "cutfac:set-license-key";

/** The paid plan unlocked or ran out, for the board to show the plan again. */
export const LICENSE_CHANGE_CHANNEL = "cutfac:license-change";

/** The app is quitting, for the board to say so while it stops its work. */
export const QUITTING_CHANNEL = "cutfac:quitting";

/** What the board shows about updates, asked for and as it changes. */
export const UPDATE_STATUS_CHANNEL = "cutfac:update-status";

export const UPDATE_STATUS_CHANGED_CHANNEL = "cutfac:update-status-changed";

/** A check from the menu found nothing newer, or failed. */
export const UPDATE_NOTICE_CHANNEL = "cutfac:update-notice";

/** Quit and install the version that is ready. */
export const UPDATE_RESTART_CHANNEL = "cutfac:update-restart";

/** Open a checkout that renews the license's updates, to get a version held back. */
export const UPDATE_RENEW_CHANNEL = "cutfac:update-renew";

/** The version the app updated to since the board last asked, if it did. */
export const UPDATED_TO_CHANNEL = "cutfac:updated-to";

/** The board asks for its license key dialog, as License Key… in the app menu does. */
export const OPEN_LICENSE_KEY_CHANNEL = "cutfac:open-license-key";

/** License Key… from the app menu, or asked for by the board, for the board to open its dialog. */
export const LICENSE_KEY_REQUEST_CHANNEL = "cutfac:license-key-request";

/** Drag a workspace file out of the board, to drop a copy of it in Finder or another app. */
export const START_DRAG_CHANNEL = "cutfac:start-drag";

/** Save a copy of a workspace file where the user picks, as Download in the editor does. */
export const DOWNLOAD_FILE_CHANNEL = "cutfac:download-file";

/** Every agent CLI as found on this computer, for the first launch's agent step. */
export const AGENTS_CHANNEL = "cutfac:agents";

/** Install, update or sign in an agent CLI with the fix its last check named. */
export const FIX_AGENT_CHANNEL = "cutfac:fix-agent";

/** A line a running fix printed, for the agent step to show. */
export const FIX_OUTPUT_CHANNEL = "cutfac:fix-output";

/** What the first launch asked about the user before there was a workspace: read, keep, forget. */
export const DRAFT_CHANNEL = "cutfac:onboarding-draft";

export const SAVE_DRAFT_CHANNEL = "cutfac:save-onboarding-draft";

export const CLEAR_DRAFT_CHANNEL = "cutfac:clear-onboarding-draft";

/** Whether this build can share with the Cutfac team, and what the person answered before. */
export const SHARING_CHANNEL = "cutfac:sharing";

/** macOS's major version, which names the lists in System Settings. */
export const SYSTEM_VERSION_CHANNEL = "cutfac:system-version";

/** Whether macOS grants the app a permission: screen recording, or accessibility. */
export const PERMISSION_CHANNEL = "cutfac:permission";

/** Put up a sample notification, which has macOS ask whether the app may notify. */
export const ASK_NOTIFICATIONS_CHANNEL = "cutfac:ask-notifications";

/** Open a permission's list in System Settings, with the helper window beside it. */
export const OPEN_ACCESS_SETTINGS_CHANNEL = "cutfac:open-access-settings";

/** A permission was granted while System Settings was open. */
export const ACCESS_GRANTED_CHANNEL = "cutfac:access-granted";

/** Drag the app itself out of the helper window, into a list in System Settings. */
export const START_APP_DRAG_CHANNEL = "cutfac:start-app-drag";

/** Make the helper window the key one as the pointer reaches it, so it shows its cursor. */
export const FOCUS_DRAG_HELPER_CHANNEL = "cutfac:focus-drag-helper";

/** The app's icon, for the helper window to show as the thing to drag. */
export const APP_ICON_CHANNEL = "cutfac:app-icon";

/** Make the first workspace from the answers so far, and start the agent reading. */
export const START_WORKSPACE_CHANNEL = "cutfac:start-workspace";

/** Where the first workspace was made, once it is. */
export const WORKSPACE_FOLDER_CHANNEL = "cutfac:workspace-folder";

/** Make the workspace folder and open the board on it. */
export const CREATE_WORKSPACE_CHANNEL = "cutfac:create-workspace";

/** Passed to the Dev Panel's page alone, for the preload script to add the dev tools to its bridge. */
export const DEV_TOOLS_FLAG = "--cutfac-dev-tools";

/**
 * Passed to the board's window in the dev build, for the preload script to add a way into the Dev
 * Panel.
 */
export const DEV_BUILD_FLAG = "--cutfac-dev-build";

/** Open the Dev Panel, from the board's sidebar in the dev build. */
export const OPEN_DEV_PANEL_CHANNEL = "cutfac:open-dev-panel";

/** The Dev Panel's tools, in the dev build only: what it fakes and where things are kept. */
export const DEV_STATE_CHANNEL = "cutfac:dev-state";

/** Something the Dev Panel shows changed, such as a faked fix that left its agent ready. */
export const DEV_STATE_CHANGED_CHANNEL = "cutfac:dev-state-changed";

export const DEV_SET_FAKES_CHANNEL = "cutfac:dev-set-fakes";

export const DEV_START_OVER_CHANNEL = "cutfac:dev-start-over";

export const DEV_RESTORE_CHANNEL = "cutfac:dev-restore";

export const DEV_OPEN_STEP_CHANNEL = "cutfac:dev-open-step";

export const DEV_REVEAL_CHANNEL = "cutfac:dev-reveal";

export const DEV_FAKE_UPDATE_CHANNEL = "cutfac:dev-fake-update";

export const DEV_RESET_FREE_COUNT_CHANNEL = "cutfac:dev-reset-free-count";
