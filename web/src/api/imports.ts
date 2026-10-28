import { Schema } from "effect";

import { ImportDoc } from "../../../src/core/importSchema.ts";
import { type AgentName } from "../../../src/core/schema.ts";
import { q, request, send, uploadForm, type Upload } from "./client.ts";
import { Reference } from "./items.ts";

export { ImportDoc, ImportTurn } from "../../../src/core/importSchema.ts";

export const ImportSummary = Schema.Struct({
  id: Schema.String,
  doc: ImportDoc,
  running: Schema.Boolean,
});

export type ImportSummary = typeof ImportSummary.Type;

export const ImportDetail = Schema.Struct({
  ...ImportSummary.fields,
  dir: Schema.String,
  references: Schema.Array(Reference),
});

export type ImportDetail = typeof ImportDetail.Type;

export interface NewImport {
  link?: string;
  kind?: ImportDoc["kind"];
  agent?: AgentName;
  locale?: string;
}

export const importApi = {
  imports: () => request(Schema.Array(ImportSummary), "/api/imports"),
  import: (id: string) => request(ImportDetail, `/api/import${q(id)}`),
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
  allowImport: (id: string, body: string) =>
    send(ImportDetail, "POST", `/api/import/reply${q(id)}`, { body, allow: true }),
  stopImport: (id: string) => send(ImportDetail, "POST", `/api/import/stop${q(id)}`, {}),
  closeImport: (id: string) => send(ImportDetail, "POST", `/api/import/close${q(id)}`, {}),
};
