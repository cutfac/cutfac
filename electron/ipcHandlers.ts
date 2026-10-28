import type { Effect } from "effect";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import { ipcCall, type Decodable, type Input } from "./ipcCall.ts";
import { forkInMain, runInMain, type AppServices } from "./runtime.ts";

type Failure = { readonly message: string };

/** Answers a page's calls on `channel` through the app's runtime, as `ipcCall` describes. */
export const answer = <S extends Decodable, A, E extends Failure>(
  channel: string,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  input: Input<S>,
  respond: (value: S["Type"], event: IpcMainInvokeEvent) => Effect.Effect<A, E, AppServices>,
) => {
  const call = ipcCall(channel, trusted, input, respond);

  ipcMain.handle(channel, (event, raw) => runInMain(call(event, raw)));
};

/** Takes a page's one-way messages on `channel` through the app's runtime, as `ipcCall` describes. */
export const listen = <S extends Decodable, A, E>(
  channel: string,
  trusted: (event: IpcMainEvent) => boolean,
  input: Input<S>,
  respond: (value: S["Type"], event: IpcMainEvent) => Effect.Effect<A, E, AppServices>,
) => {
  const call = ipcCall(channel, trusted, input, respond);

  ipcMain.on(channel, (event, raw) => forkInMain(call(event, raw)));
};
