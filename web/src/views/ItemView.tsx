import { useRef, useState } from "react";
import {
  api,
  fileUrl,
  STATUSES,
  type Check,
  type ItemDetail,
  type Media,
  type Status,
} from "../api.ts";
import { formatTime, href, useLive } from "../hooks.ts";

export function ItemView({ id }: { id: string }) {
  const { data: item, error, setData } = useLive(() => api.item(id), [id]);
  const [mediaName, setMediaName] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);

  if (error) return <p className="error">{error}</p>;
  if (!item) return <p className="muted">Loading…</p>;

  const media =
    item.media.find((m) => m.name === mediaName) ??
    item.media.find((m) => m.kind === "video") ??
    item.media[0];

  return (
    <section className="item">
      <div className="toolbar">
        <a href={href("board")} className="muted">
          ← Board
        </a>
        <h1>{item.doc.title}</h1>
        <div className="spacer" />
        <StatusSelect item={item} onChange={setData} />
      </div>
      <div className="item-grid">
        <div className="preview">
          {media ? (
            <MediaPreview dir={item.dir} media={media} videoRef={videoRef} />
          ) : (
            <p className="muted">No media yet.</p>
          )}
          {item.media.length > 1 ? (
            <div className="strip">
              {item.media.map((m) => (
                <button
                  key={m.name}
                  className={m.name === media?.name ? "active" : ""}
                  onClick={() => setMediaName(m.name)}
                >
                  {m.kind === "image" ? (
                    <img src={fileUrl(`${item.dir}/${m.name}`)} alt="" loading="lazy" />
                  ) : (
                    <span>▶</span>
                  )}
                  <small>{m.name}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="side">
          <FeedbackPanel item={item} media={media} videoRef={videoRef} onChange={setData} />
          <Verify id={item.id} />
          <Details item={item} />
        </div>
      </div>
    </section>
  );
}

function MediaPreview({
  dir,
  media,
  videoRef,
}: {
  dir: string;
  media: Media;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const src = fileUrl(`${dir}/${media.name}`);
  if (media.kind === "video")
    return <video key={src} ref={videoRef} src={src} controls playsInline />;
  return <img src={src} alt={media.name} />;
}

function StatusSelect({
  item,
  onChange,
}: {
  item: ItemDetail;
  onChange: (item: ItemDetail) => void;
}) {
  return (
    <select
      value={item.doc.status}
      onChange={async (e) =>
        onChange(await api.updateItem(item.id, { status: e.target.value as Status }))
      }
    >
      {STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

function FeedbackPanel({
  item,
  media,
  videoRef,
  onChange,
}: {
  item: ItemDetail;
  media: Media | undefined;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onChange: (item: ItemDetail) => void;
}) {
  const [body, setBody] = useState("");
  const [atTime, setAtTime] = useState(true);
  const [copied, setCopied] = useState(false);
  const open = item.doc.feedback.filter((f) => f.status === "open");
  const resolved = item.doc.feedback.filter((f) => f.status === "resolved");
  const isVideo = media?.kind === "video";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const input: { body: string; media?: string; timecode?: number } = { body };
    if (media) input.media = media.name;
    if (isVideo && atTime && videoRef.current)
      input.timecode = Math.round(videoRef.current.currentTime * 10) / 10;
    onChange(await api.addFeedback(item.id, input));
    setBody("");
  }

  async function copyPrompt() {
    const prompt = `Use the content-factory tools to handle the open review feedback on item "${item.id}" (${item.doc.title}). Fix each comment, run verify_item, and resolve each feedback entry with what changed.`;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Feedback</h2>
        {open.length ? (
          <button onClick={copyPrompt} title="Paste into Claude Code or Codex">
            {copied ? "Copied" : "Copy agent prompt"}
          </button>
        ) : null}
      </div>
      <form onSubmit={submit} className="feedback-form">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What should change?"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
          }}
        />
        <div className="row">
          {isVideo ? (
            <label className="check">
              <input
                type="checkbox"
                checked={atTime}
                onChange={(e) => setAtTime(e.target.checked)}
              />{" "}
              At current time
            </label>
          ) : null}
          <div className="spacer" />
          <button type="submit" className="primary" disabled={!body.trim()}>
            Add
          </button>
        </div>
      </form>
      {open.map((f) => (
        <div key={f.id} className="feedback">
          <p>
            {typeof f.timecode === "number" ? (
              <button
                className="time"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = f.timecode!;
                }}
              >
                {formatTime(f.timecode)}
              </button>
            ) : null}
            {f.body}
          </p>
          <small className="muted">
            {f.media ?? "item"} · {new Date(f.at).toLocaleString()}
            <button
              className="link"
              onClick={async () => onChange(await api.resolveFeedback(item.id, f.id))}
            >
              Resolve
            </button>
          </small>
        </div>
      ))}
      {resolved.length ? (
        <details>
          <summary className="muted">{resolved.length} resolved</summary>
          {resolved.map((f) => (
            <div key={f.id} className="feedback resolved">
              <p>{f.body}</p>
              {f.resolution ? <small>→ {f.resolution}</small> : null}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

function Verify({ id }: { id: string }) {
  const [reports, setReports] = useState<{ file: string; ok: boolean; checks: Check[] }[]>();
  const [running, setRunning] = useState(false);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Upload checks</h2>
        <button
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              setReports(await api.verify(id));
            } finally {
              setRunning(false);
            }
          }}
        >
          {running ? "Checking…" : "Run"}
        </button>
      </div>
      {reports?.length === 0 ? <p className="muted">No videos to check.</p> : null}
      {reports?.map((r) => (
        <div key={r.file}>
          <strong className={r.ok ? "ok" : "bad"}>
            {r.ok ? "✓" : "✗"} {r.file}
          </strong>
          <ul className="checks">
            {r.checks.map((c) => (
              <li key={c.name} className={c.ok ? "ok" : "bad"}>
                {c.name}: {c.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Details({ item }: { item: ItemDetail }) {
  const { doc } = item;
  const platforms = Object.entries(doc.platforms);
  return (
    <div className="panel">
      <h2>Details</h2>
      <dl>
        {doc.format ? (
          <>
            <dt>Format</dt>
            <dd>{doc.format}</dd>
          </>
        ) : null}
        {doc.reference ? (
          <>
            <dt>Reference</dt>
            <dd>
              <a href={href("references", doc.reference)}>{doc.reference}</a>
            </dd>
          </>
        ) : null}
        {doc.hook ? (
          <>
            <dt>Hook</dt>
            <dd>{doc.hook}</dd>
          </>
        ) : null}
        {doc.caption ? (
          <>
            <dt>Caption</dt>
            <dd className="pre">{doc.caption}</dd>
          </>
        ) : null}
      </dl>
      {platforms.map(([p, copy]) => (
        <details key={p}>
          <summary>{p}</summary>
          {copy.title ? (
            <p>
              <strong>{copy.title}</strong>
            </p>
          ) : null}
          {copy.caption ? <p className="pre">{copy.caption}</p> : null}
          {copy.hashtags?.length ? <p className="muted">{copy.hashtags.join(" ")}</p> : null}
          {copy.firstComment ? (
            <p className="pre muted">First comment: {copy.firstComment}</p>
          ) : null}
        </details>
      ))}
      {doc.schedule.length ? (
        <>
          <h3>Schedule</h3>
          <ul className="plain">
            {doc.schedule.map((s) => (
              <li key={s.platform}>
                {s.platform} · {new Date(s.at).toLocaleString()} · {s.status}
                {s.url ? (
                  <>
                    {" "}
                    ·{" "}
                    <a href={s.url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {doc.metrics.length ? (
        <>
          <h3>Metrics</h3>
          <table className="metrics">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Date</th>
                <th>Views</th>
                <th>Likes</th>
                <th>Shares</th>
                <th>Saves</th>
              </tr>
            </thead>
            <tbody>
              {doc.metrics.map((m) => (
                <tr key={`${m.platform}-${m.at}`}>
                  <td>{m.platform}</td>
                  <td>{new Date(m.at).toLocaleDateString()}</td>
                  <td>{m.views ?? "–"}</td>
                  <td>{m.likes ?? "–"}</td>
                  <td>{m.shares ?? "–"}</td>
                  <td>{m.saves ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {doc.notes ? <p className="pre muted">{doc.notes}</p> : null}
      {Object.entries(item.docs).map(([name, text]) => (
        <details key={name}>
          <summary>{name}</summary>
          <pre className="doc">{text}</pre>
        </details>
      ))}
    </div>
  );
}
