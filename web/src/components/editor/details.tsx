import { FileTextIcon } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { api, type ItemDetail, type ItemPatch } from "../../api.ts";
import { href, useLive } from "../../hooks.ts";
import { useMessages } from "../../i18n/index.ts";

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

/**
 * The item's plan. Title, hook, and notes save when you leave the field, as changes you can undo.
 */
export function Details({
  item,
  onItem,
}: {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
}) {
  const { doc } = item;
  const docs = Object.entries(item.docs);
  const t = useMessages();
  const { data: formats } = useLive("formats", api.formats);
  const format = formats?.find((f) => f.id === doc.format);

  // Inputs read best by the titles their template gives them, as written when it is gone.
  const inputs = Object.entries(doc.inputs ?? {}).flatMap(([id, value]) => {
    if (value === undefined) return [];

    const field = format?.doc.inputs.find((f) => f.id === id);
    const choice = field?.choices.find((c) => c.id === value);

    return [{ id, label: field?.title ?? id, value: choice?.title ?? value }];
  });

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
          {doc.format === undefined ? null : (
            <Fact label={t.item.format}>
              <a href={href("templates", doc.format)} className="underline underline-offset-4">
                {format?.doc.title ?? doc.format}
              </a>
            </Fact>
          )}
          {inputs.map((input) => (
            <Fact key={input.id} label={input.label}>
              {input.value}
            </Fact>
          ))}
          {doc.reference === undefined ? null : (
            <Fact label={t.item.reference}>{doc.reference}</Fact>
          )}
        </dl>
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
