import { Option } from "effect";

import { Badge } from "@/components/ui/badge";

import { fileUrl, type InputChoice, type InputField } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { isClip } from "../lib/templates.ts";

export function TemplateInputs({
  inputs,
  dir,
  missing,
}: {
  inputs: ReadonlyArray<InputField>;
  dir: string;
  missing: ReadonlySet<string>;
}) {
  const t = useMessages();

  if (inputs.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">{t.templates.inputs}</h2>
        <p className="text-muted-foreground">{t.templates.inputsBody}</p>
      </div>
      {inputs.map((field) => (
        <InputSummary key={field.id} field={field} dir={dir} missing={missing} />
      ))}
    </section>
  );
}

function InputSummary({
  field,
  dir,
  missing,
}: {
  field: InputField;
  dir: string;
  missing: ReadonlySet<string>;
}) {
  const t = useMessages();
  const freeText = field.choices.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{field.title}</h3>
        {field.required ? <Badge variant="outline">{t.templates.required}</Badge> : null}
        {freeText ? <Badge variant="ghost">{t.templates.freeText}</Badge> : null}
      </div>
      {field.description === undefined ? null : (
        <p className="text-muted-foreground">{field.description}</p>
      )}
      {freeText && field.default !== undefined ? (
        <p className="text-muted-foreground">{t.templates.defaultValue(field.default)}</p>
      ) : null}
      {freeText ? null : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
          {field.choices.map((choice) => (
            <ChoiceCard
              key={choice.id}
              choice={choice}
              dir={dir}
              missing={missing}
              isDefault={choice.id === field.default}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChoiceCard({
  choice,
  dir,
  missing,
  isDefault,
}: {
  choice: InputChoice;
  dir: string;
  missing: ReadonlySet<string>;
  isDefault: boolean;
}) {
  const t = useMessages();

  const preview = Option.fromUndefinedOr(choice.preview).pipe(
    Option.filter((path) => !missing.has(path)),
  );

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border">
      {Option.isSome(preview) ? (
        <ChoicePreview path={`${dir}/${preview.value}`} title={choice.title} />
      ) : null}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{choice.title}</span>
          {isDefault ? <Badge variant="secondary">{t.templates.default}</Badge> : null}
        </div>
        {choice.summary === undefined ? null : (
          <p className="text-muted-foreground">{choice.summary}</p>
        )}
      </div>
    </div>
  );
}

function ChoicePreview({ path, title }: { path: string; title: string }) {
  return isClip(path) ? (
    // Preview clips are silent loops that show a look, so they have no captions.
    // oxlint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={fileUrl(path)}
      className="aspect-video w-full bg-muted object-cover"
      muted
      loop
      playsInline
      controls
    />
  ) : (
    <img
      src={fileUrl(path)}
      alt={title}
      loading="lazy"
      className="aspect-video w-full bg-muted object-cover"
    />
  );
}
