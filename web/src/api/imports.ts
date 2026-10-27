import { Schema } from "effect";

import { type AgentName, ImportDoc } from "../../../src/core/schema.ts";
import { q, request, send, uploadForm, type Upload } from "./client.ts";
import { Reference } from "./items.ts";

export { ImportDoc, ImportTurn } from "../../../src/core/schema.ts";

/** An import as the list of imports shows it. */
export const ImportSummary = Schema.Struct({
  id: Schema.String,
  doc: ImportDoc,
  running: Schema.Boolean,
});

export type ImportSummary = typeof ImportSummary.Type;

/** An import as its chat shows it. */
export const ImportDetail = Schema.Struct({
  ...ImportSummary.fields,
  /** Workspace-relative folder of the import, which the paths of its files are relative to. */
  dir: Schema.String,
  /** Every file the user sent to the import's agent. */
  references: Schema.Array(Reference),
});

export type ImportDetail = typeof ImportDetail.Type;

export interface NewImport {
  /** Only a brief import may go without a link. */
  link?: string;
  kind?: ImportDoc["kind"];
  agent?: AgentName;
  /** The board's language, for the agent to write in. */
  locale?: string;
}

export const importApi = {
  imports: () => request(Schema.Array(ImportSummary), "/api/imports"),
  import: (id: string) => request(ImportDetail, `/api/import${q(id)}`),
  /**
   * Start the user's agent on a link and any files that go with it. It can only read until the user
   * allows installs.
   */
  startImport: (input: NewImport, uploads: ReadonlyArray<Upload> = []) =>
    uploads.length === 0
      ? send(ImportDetail, "POST", "/api/imports", input)
      : request(ImportDetail, "/api/imports", {
          method: "POST",
          body: uploadForm(uploads, { ...input }),
        }),
  replyImport: (id: string, body: string, uploads: ReadonlyArray<Upload> = []) =>
    uploads.length === 0
      ? send(ImportDetail, "POST", `/api/import/reply${q(id)}`, { body })
      : request(ImportDetail, `/api/import/reply${q(id)}`, {
          method: "POST",
          body: uploadForm(uploads, { body }),
        }),
  /** Let the agent install and write what it listed, with an optional note. */
  allowImport: (id: string, body: string) =>
    send(ImportDetail, "POST", `/api/import/reply${q(id)}`, { body, allow: true }),
  stopImport: (id: string) => send(ImportDetail, "POST", `/api/import/stop${q(id)}`, {}),
  /** Stop the agent if it is working and set the import aside. */
  closeImport: (id: string) => send(ImportDetail, "POST", `/api/import/close${q(id)}`, {}),
};
