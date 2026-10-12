import { useState } from "react";
import { api } from "../api.ts";
import { href, useLive } from "../hooks.ts";

interface Entry {
  id: string;
  title: string;
  platform: string;
  at: Date;
  status: string;
}

export function Calendar() {
  const { data: items, error } = useLive(api.items);
  const [offset, setOffset] = useState(0);

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;

  const entries: Entry[] = items.flatMap((i) =>
    i.schedule.map((s) => ({
      id: i.id,
      title: i.title,
      platform: s.platform,
      at: new Date(s.at),
      status: s.status,
    })),
  );
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7)); // Monday-first grid
  const days = Array.from(
    { length: 42 },
    (_, n) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + n),
  );
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const byDay = new Map<string, Entry[]>();
  for (const e of entries) byDay.set(key(e.at), [...(byDay.get(key(e.at)) ?? []), e]);

  return (
    <section>
      <div className="toolbar">
        <h1>{month.toLocaleDateString(undefined, { year: "numeric", month: "long" })}</h1>
        <div className="spacer" />
        <button onClick={() => setOffset(offset - 1)}>←</button>
        <button onClick={() => setOffset(0)}>Today</button>
        <button onClick={() => setOffset(offset + 1)}>→</button>
      </div>
      <div className="calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="dow">
            {d}
          </div>
        ))}
        {days.map((d) => (
          <div
            key={key(d)}
            className={`day${d.getMonth() !== month.getMonth() ? " outside" : ""}${key(d) === key(now) ? " today" : ""}`}
          >
            <span className="date">{d.getDate()}</span>
            {(byDay.get(key(d)) ?? [])
              .sort((a, b) => a.at.getTime() - b.at.getTime())
              .map((e) => (
                <a
                  key={`${e.id}-${e.platform}`}
                  href={href("item", e.id)}
                  className={`event ${e.status}`}
                >
                  {e.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}{" "}
                  {e.platform} · {e.title}
                </a>
              ))}
          </div>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="muted">Nothing scheduled. Agents record schedules with set_schedule.</p>
      ) : null}
    </section>
  );
}
