import { useState } from "react";
import { api, fileUrl, STATUSES, type ItemSummary } from "../api.ts";
import { href, useLive } from "../hooks.ts";

export function Board() {
  const { data: items, error } = useLive(api.items);
  const [showArchived, setShowArchived] = useState(false);
  const [format, setFormat] = useState("");

  if (error) return <p className="error">{error}</p>;
  if (!items) return <p className="muted">Loading…</p>;

  const formats = [...new Set(items.map((i) => i.format).filter(Boolean))] as string[];
  const visible = items.filter((i) => !format || i.format === format);
  const columns = STATUSES.filter((s) => showArchived || s !== "archived");

  return (
    <section>
      <div className="toolbar">
        <h1>Board</h1>
        <span className="muted">{items.length} items</span>
        <div className="spacer" />
        {formats.length > 0 ? (
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">All formats</option>
            {formats.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />{" "}
          Archived
        </label>
      </div>
      <div className="board">
        {columns.map((status) => {
          const cards = visible
            .filter((i) => i.status === status)
            .sort((a, b) => b.updatedAt - a.updatedAt);
          return (
            <div key={status} className="column">
              <h2>
                {status} <span className="muted">{cards.length}</span>
              </h2>
              {cards.map((item) => (
                <Card key={item.id} item={item} />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({ item }: { item: ItemSummary }) {
  const thumb =
    item.media.find((m) => m.kind === "image" && m.aspect === "9x16") ??
    item.media.find((m) => m.kind === "image");
  const video = item.media.find((m) => m.kind === "video");
  const next = item.schedule
    .filter((s) => s.status !== "cancelled")
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  return (
    <a className="card" href={href("item", item.id)}>
      {thumb ? (
        <img src={fileUrl(`${item.dir}/${thumb.name}`)} alt="" loading="lazy" />
      ) : video ? (
        <video src={`${fileUrl(`${item.dir}/${video.name}`)}#t=0.5`} preload="metadata" muted />
      ) : null}
      <strong>{item.title}</strong>
      {item.hook ? <span className="hook">{item.hook}</span> : null}
      <span className="meta">
        {item.format ? <span>{item.format}</span> : null}
        {item.media.length ? <span>{item.media.length} files</span> : null}
        {next ? (
          <span>
            {new Date(next.at).toLocaleDateString()} · {next.platform}
          </span>
        ) : null}
        {item.openFeedback ? <span className="badge">{item.openFeedback} feedback</span> : null}
        {item.legacy ? (
          <span title="Folder without item.yaml; status derived from STATUS.md">legacy</span>
        ) : null}
      </span>
    </a>
  );
}
