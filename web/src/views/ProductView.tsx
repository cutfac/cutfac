import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorAlert, Page } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { badgeVariants } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";

import { api, fileUrl } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { ImportForm } from "./Setup.tsx";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Screenshots and recordings side by side, scrolling sideways instead of wrapping. */
function MediaStrip({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 overflow-x-auto pb-2">{children}</div>;
}

const MEDIA_CLASS = "h-64 w-auto shrink-0 rounded-2xl border bg-muted object-contain";

export function ProductView() {
  const t = useMessages();
  const { data: ws, error } = useLive("workspace", api.workspace);

  if (error) {
    return (
      <Page title={t.product.title} width="narrow">
        <ErrorAlert title={t.product.loadError} message={error} />
      </Page>
    );
  }

  if (ws === undefined) {
    return (
      <Page title={t.product.title} width="narrow">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </Page>
    );
  }

  const product = ws.product.doc;
  const productDir = ws.config.paths.product;
  const storeImages = ws.product.store.filter((m) => m.kind === "image");

  return (
    <Page width="narrow" title={product?.name ?? t.product.title} description={product?.oneLiner}>
      {product ? (
        <Section title={t.product.about}>
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">{t.product.audience}</dt>
              <dd>{product.audience}</dd>
              <dt className="text-muted-foreground">{t.product.cta}</dt>
              <dd>{product.cta.default}</dd>
            </dl>
            {product.rules.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className="font-medium">{t.product.rules}</h2>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {product.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Section>
      ) : (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t.product.missingTitle}</AlertTitle>
          <AlertDescription>
            {t.product.missingBody(<code>product/product.yaml</code>)}
          </AlertDescription>
        </Alert>
      )}

      <Section title={t.product.importTitle} description={t.product.importBody}>
        <ImportForm />
      </Section>

      {storeImages.length > 0 ? (
        <Section title={t.product.store}>
          <MediaStrip>
            {storeImages.map((m) => (
              <img
                key={m.name}
                src={fileUrl(`${productDir}/store/${m.name}`, m.mtime)}
                alt={m.name}
                loading="lazy"
                className={MEDIA_CLASS}
              />
            ))}
          </MediaStrip>
        </Section>
      ) : null}

      <Section title={t.product.captures}>
        {ws.product.captures.length > 0 ? (
          <MediaStrip>
            {ws.product.captures.map((m) =>
              m.kind === "image" ? (
                <img
                  key={m.name}
                  src={fileUrl(`${productDir}/captures/${m.name}`, m.mtime)}
                  alt={m.name}
                  loading="lazy"
                  className={MEDIA_CLASS}
                />
              ) : (
                <video
                  key={m.name}
                  src={fileUrl(`${productDir}/captures/${m.name}`, m.mtime)}
                  className={MEDIA_CLASS}
                  controls
                  muted
                />
              ),
            )}
          </MediaStrip>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.product.capturesEmpty(<code>product/captures/</code>)}
          </p>
        )}
      </Section>

      <Section title={t.product.formats} description={t.product.formatsBody}>
        {ws.formats.length > 0 ? (
          <ItemGroup>
            {ws.formats.map((f) => (
              <Item key={f.id} variant="outline">
                <ItemContent>
                  <ItemTitle>{f.doc.title}</ItemTitle>
                  <ItemDescription>{f.doc.summary}</ItemDescription>
                </ItemContent>
                {f.doc.references.length > 0 ? (
                  <ItemFooter>
                    <div className="flex flex-wrap gap-1">
                      {f.doc.references.map((r) => (
                        <a
                          key={r}
                          href={href("references", r)}
                          className={badgeVariants({ variant: "outline" })}
                        >
                          {r}
                        </a>
                      ))}
                    </div>
                  </ItemFooter>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t.product.formatsEmpty((text) => (
              <a href={href("references")} className="underline underline-offset-4">
                {text}
              </a>
            ))}
          </p>
        )}
      </Section>
    </Page>
  );
}
