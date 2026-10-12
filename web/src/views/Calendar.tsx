import { cva } from "class-variance-authority";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { ErrorAlert, Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useLocale, useMessages, type Locale } from "../i18n/index.ts";

interface Entry {
  id: string;
  title: string;
  platform: string;
  at: Date;
  status: string;
}

/** Short weekday names in the grid's Monday-first order. */
function weekdays(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short" });

  // 1 January 2024 was a Monday.
  return Array.from({ length: 7 }, (_, n) => format.format(new Date(2024, 0, 1 + n)));
}

const eventVariants = cva(
  "block min-w-0 rounded-lg px-1.5 py-1 text-xs leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      state: {
        planned: "bg-secondary text-secondary-foreground hover:bg-accent",
        published: "bg-primary text-primary-foreground hover:bg-primary/80",
        cancelled: "bg-muted text-muted-foreground line-through hover:bg-accent",
      },
    },
    defaultVariants: { state: "planned" },
  },
);

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function Calendar() {
  const t = useMessages();
  const locale = useLocale();
  const { data: items, error } = useLive("items", api.items);
  const [offset, setOffset] = useState(0);
  const [now] = useState(() => new Date());

  if (error) {
    return (
      <Page title={t.calendar.title}>
        <ErrorAlert title={t.calendar.loadError} message={error} />
      </Page>
    );
  }

  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7)); // Monday-first grid

  const days = Array.from(
    { length: 42 },
    (_, n) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + n),
  );

  const entries: Entry[] = (items ?? []).flatMap((i) =>
    i.schedule.map((s) => ({
      id: i.id,
      title: i.title,
      platform: s.platform,
      at: new Date(s.at),
      status: s.status,
    })),
  );

  const byDay = new Map<string, Entry[]>();

  for (const e of entries) byDay.set(dayKey(e.at), [...(byDay.get(dayKey(e.at)) ?? []), e]);

  return (
    <Page
      width="wide"
      title={month.toLocaleDateString(locale, { year: "numeric", month: "long" })}
      description={items && entries.length === 0 ? t.calendar.empty : undefined}
      actions={
        <>
          <Button
            variant="outline"
            size="icon"
            aria-label={t.calendar.previous}
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(0)}>
            {t.calendar.today}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t.calendar.next}
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </>
      }
    >
      {items === undefined ? (
        <Skeleton className="h-130 w-full" />
      ) : (
        <div className="grid grid-cols-7 overflow-hidden rounded-3xl border">
          {weekdays(locale).map((d) => (
            <div
              key={d}
              className="border-b bg-muted/40 px-2 py-2 text-xs font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
          {days.map((d, n) => {
            const today = dayKey(d) === dayKey(now);
            const outside = d.getMonth() !== month.getMonth();

            const events = (byDay.get(dayKey(d)) ?? []).toSorted(
              (a, b) => a.at.getTime() - b.at.getTime(),
            );

            return (
              <div
                key={dayKey(d)}
                className={`flex min-h-28 min-w-0 flex-col gap-1 border-b p-1.5 ${n % 7 === 0 ? "" : "border-l"} ${outside ? "bg-muted/30 text-muted-foreground" : ""}`}
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-full text-xs ${today ? "bg-primary font-medium text-primary-foreground" : ""}`}
                  aria-current={today ? "date" : undefined}
                >
                  {d.getDate()}
                </span>
                {events.map((e) => (
                  <a
                    key={`${e.id}-${e.platform}-${e.at.getTime()}`}
                    href={href("item", e.id)}
                    title={`${e.platform} · ${e.title} (${t.scheduleStatus(e.status)})`}
                    className={eventVariants({
                      state:
                        e.status === "published" || e.status === "cancelled" ? e.status : "planned",
                    })}
                  >
                    <span className="block truncate font-medium">
                      {e.at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })} ·{" "}
                      {e.platform}
                    </span>
                    <span className="block truncate">{e.title}</span>
                    <span className="sr-only">, {t.scheduleStatus(e.status)}</span>
                  </a>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
