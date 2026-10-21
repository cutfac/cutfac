import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { insetTitleBar } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/** Room above a view's title. The macOS title bar strip above already gives the title most of it. */
export const pageTop: string = insetTitleBar ? "pt-2" : "pt-6";

const pageVariants = cva(`mx-auto flex w-full flex-col gap-6 px-6 pb-6 ${pageTop}`, {
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

/** A scrolling view's frame: a title row, then the content, centred at a readable width. */
export function Page({ title, description, actions, width, children }: PageProps) {
  return (
    <div className={pageVariants({ width })}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
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
