import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InTitleBar } from "@/components/title-bar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { useMessages } from "../i18n/index.ts";

const pageVariants = cva("mx-auto flex w-full flex-col gap-6 px-6 pt-2 pb-6", {
  variants: {
    width: { narrow: "max-w-2xl", default: "max-w-5xl", wide: "max-w-7xl" },
  },
  defaultVariants: { width: "default" },
});

interface PageProps extends VariantProps<typeof pageVariants> {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** A view's title in the title bar, with what goes beside it and its actions at the far end. */
export function PageHeader({
  title,
  aside,
  actions,
}: {
  title: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <InTitleBar>
      <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
      {aside}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
    </InTitleBar>
  );
}

/** A scrolling view's frame: its title in the title bar, then the content at a readable width. */
export function Page({ title, description, actions, width, children }: PageProps) {
  return (
    <div className={pageVariants({ width })}>
      <PageHeader title={title} actions={actions} />
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

export function ErrorAlert({ title, message }: { title?: string; message: string }) {
  const t = useMessages();

  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>{title ?? t.common.somethingWrong}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Placeholder rows while a view's first load is in flight. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      {Array.from({ length: rows }, (_, n) => (
        <Skeleton key={n} className="h-16 w-full" />
      ))}
    </div>
  );
}
