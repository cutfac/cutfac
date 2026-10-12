import { FileTextIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { safeHttpUrl } from "@/lib/utils";

import { api, type ItemDetail, type ItemPatch } from "../../api.ts";
import { href } from "../../hooks.ts";
import { type Locale, useLocale, useMessages } from "../../i18n/index.ts";

const showError = (cause: Error) => {
  toast.error(cause.message);
};

interface TextFieldProps {
  id: string;
  label: string;
  /** What the item has saved. */
  value: string;
  placeholder?: string;
  multiline?: boolean;
  /** Shown instead of saving an empty value. */
  required?: string;
  onSave: (value: string) => Promise<void>;
}

/**
 * A field that saves when it loses focus. Enter leaves a one-line field, ⌘ or Ctrl+Enter a longer
 * one, and Escape puts back what was saved.
 */
function TextField({
  id,
  label,
  value,
  placeholder,
  multiline = false,
  required,
  onSave,
}: TextFieldProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const discard = useRef(false);

  function commit() {
    const sent = draft;
    const next = sent?.trim();

    if (discard.current || next === undefined || next === value) {
      discard.current = false;
      setDraft(undefined);

      return;
    }

    if (next === "" && required !== undefined) {
      toast.error(required);
      setDraft(undefined);

      return;
    }

    // The draft stays up until the saved item replaces it, unless typing went on meanwhile.
    onSave(next).finally(() => setDraft((current) => (current === sent ? undefined : current)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // Enter while an IME is composing (Korean, Japanese, …) confirms the syllable, not the field.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === "Escape") {
      discard.current = true;
      event.currentTarget.blur();
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={id}
          value={draft ?? value}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <Input
          id={id}
          value={draft ?? value}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      )}
    </Field>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

const count = (value: number | undefined, locale: Locale) => value?.toLocaleString(locale) ?? "–";

/**
 * The item's plan and record. Title, hook, caption, and notes save when you leave the field, as
 * changes you can undo; captions per platform, schedule, and numbers come from the agents.
 */
export function Details({
  item,
  onItem,
}: {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
}) {
  const { doc } = item;
  const platforms = Object.entries(doc.platforms);
  const docs = Object.entries(item.docs);
  const t = useMessages();
  const locale = useLocale();

  const save = (patch: ItemPatch) => api.updateItem(item.id, patch).then(onItem, showError);

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <TextField
          id="item-title"
          label={t.item.title}
          value={doc.title}
          required={t.item.titleRequired}
          onSave={(title) => save({ title })}
        />
        <TextField
          id="item-hook"
          label={t.item.hook}
          value={doc.hook ?? ""}
          placeholder={t.item.hookPlaceholder}
          multiline
          onSave={(hook) => save({ hook })}
        />
        <TextField
          id="item-caption"
          label={t.item.caption}
          value={doc.caption ?? ""}
          placeholder={t.item.captionPlaceholder}
          multiline
          onSave={(caption) => save({ caption })}
        />
        <TextField
          id="item-notes"
          label={t.item.notes}
          value={doc.notes ?? ""}
          placeholder={t.item.notesPlaceholder}
          multiline
          onSave={(notes) => save({ notes })}
        />
      </FieldGroup>
      {doc.format === undefined && doc.reference === undefined ? null : (
        <dl className="flex flex-col gap-3">
          {doc.format === undefined ? null : <Fact label={t.item.format}>{doc.format}</Fact>}
          {doc.reference === undefined ? null : (
            <Fact label={t.item.reference}>
              <a href={href("references", doc.reference)} className="underline underline-offset-4">
                {doc.reference}
              </a>
            </Fact>
          )}
        </dl>
      )}
      {platforms.map(([platform, copy]) =>
        copy === undefined ? null : (
          <section key={platform} className="flex flex-col gap-1.5">
            <h2 className="font-medium capitalize">{platform}</h2>
            {copy.title === undefined ? null : <p className="font-medium">{copy.title}</p>}
            {copy.caption === undefined ? null : (
              <p className="whitespace-pre-wrap">{copy.caption}</p>
            )}
            {copy.hashtags === undefined || copy.hashtags.length === 0 ? null : (
              <p className="text-muted-foreground">{copy.hashtags.join(" ")}</p>
            )}
            {copy.firstComment === undefined ? null : (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {t.item.firstComment(copy.firstComment)}
              </p>
            )}
          </section>
        ),
      )}
      {doc.schedule.length === 0 ? null : (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium">{t.item.schedule}</h2>
          <ul className="flex flex-col gap-1">
            {doc.schedule.map((slot) => {
              const link = slot.url === undefined ? undefined : safeHttpUrl(slot.url);

              return (
                <li key={slot.platform} className="text-muted-foreground">
                  <span className="text-foreground capitalize">{slot.platform}</span> ·{" "}
                  {new Date(slot.at).toLocaleString(locale)} · {t.scheduleStatus(slot.status)}
                  {link === undefined ? null : (
                    <>
                      {" · "}
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        {t.item.open}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {doc.metrics.length === 0 ? null : (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium">{t.item.metrics}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">{t.item.platform}</th>
                  <th className="py-1 font-medium">{t.item.date}</th>
                  <th className="py-1 text-right font-medium">{t.item.views}</th>
                  <th className="py-1 text-right font-medium">{t.item.likes}</th>
                  <th className="py-1 text-right font-medium">{t.item.shares}</th>
                  <th className="py-1 text-right font-medium">{t.item.saves}</th>
                </tr>
              </thead>
              <tbody>
                {doc.metrics.map((row) => (
                  <tr key={`${row.platform}-${row.at}`} className="border-t">
                    <td className="py-1 capitalize">{row.platform}</td>
                    <td className="py-1">{new Date(row.at).toLocaleDateString(locale)}</td>
                    <td className="py-1 text-right">{count(row.views, locale)}</td>
                    <td className="py-1 text-right">{count(row.likes, locale)}</td>
                    <td className="py-1 text-right">{count(row.shares, locale)}</td>
                    <td className="py-1 text-right">{count(row.saves, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {docs.map(([name, text]) =>
        text === undefined ? null : (
          <details key={name} className="group/doc">
            <summary className="-mx-1 flex items-center gap-1.5 rounded-md px-1 font-medium outline-none select-none focus-visible:bg-muted">
              <FileTextIcon className="size-4 text-muted-foreground" />
              {name}
            </summary>
            <div className="typeset typeset-chat mt-2">
              <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            </div>
          </details>
        ),
      )}
    </div>
  );
}
