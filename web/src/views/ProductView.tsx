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
  const { data: ws, error } = useLive("workspace", api.workspace);

  if (error) {
    return (
      <Page title="Product" width="narrow">
        <ErrorAlert title="Could not load the product" message={error} />
      </Page>
    );
  }

  if (ws === undefined) {
    return (
      <Page title="Product" width="narrow">
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
    <Page width="narrow" title={product?.name ?? "Product"} description={product?.oneLiner}>
      {product ? (
        <Section title="About">
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Audience</dt>
              <dd>{product.audience}</dd>
              <dt className="text-muted-foreground">Default CTA</dt>
              <dd>{product.cta.default}</dd>
            </dl>
            {product.rules.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h2 className="font-medium">Rules</h2>
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
          <AlertTitle>No product details yet</AlertTitle>
          <AlertDescription>
            Import them from a link below, or fill in <code>product/product.yaml</code>. Every agent
            run reads it.
          </AlertDescription>
        </Alert>
      )}

      <Section
        title="Import from a link"
        description="Fills empty fields and refreshes store screenshots. Your edits to product.yaml are kept."
      >
        <ImportForm />
      </Section>

      {storeImages.length > 0 ? (
        <Section title="Store listing">
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

      <Section title="App captures">
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
            Add reviewed screenshots or screen recordings to <code>product/captures/</code>. Agents
            use them in the videos.
          </p>
        )}
      </Section>

      <Section title="Formats" description="The reusable recipes your agent makes videos from.">
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
            No formats yet.{" "}
            <a href={href("references")} className="underline underline-offset-4">
              Analyze a reference
            </a>{" "}
            and ask your agent to save one.
          </p>
        )}
      </Section>
    </Page>
  );
}
