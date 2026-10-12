import { useState } from "react";
import { api, fileUrl, type Reference } from "../api.ts";
import { href, useLive } from "../hooks.ts";

export function References({ selected }: { selected: string | undefined }) {
  const { data: refs, error, reload } = useLive(api.references);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>();
  const [addError, setAddError] = useState<string>();

  async function add(run: () => Promise<Reference>, label: string) {
    setBusy(label);
    setAddError(undefined);
    try {
      const ref = await run();
      location.hash = href("references", ref.id);
      reload();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(undefined);
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!refs) return <p className="muted">Loading…</p>;
  const current = refs.find((r) => r.id === selected);

  return (
    <section>
      <div className="toolbar">
        <h1>References</h1>
        <span className="muted">{refs.length}</span>
      </div>
      <div
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void add(() => api.addReferenceFile(file), `Processing ${file.name}…`);
        }}
      >
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim())
              void add(() => api.addReferenceUrl(url.trim()), "Downloading and processing…").then(
                () => setUrl(""),
              );
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a TikTok, Reels, or Shorts URL — or drop a video file here"
          />
          <button type="submit" className="primary" disabled={Boolean(busy)}>
            Add
          </button>
        </form>
        {busy ? <p className="muted">{busy}</p> : null}
        {addError ? <p className="error">{addError}</p> : null}
      </div>
      <div className="ref-layout">
        <ul className="ref-list">
          {refs.map((r) => (
            <li key={r.id}>
              <a href={href("references", r.id)} className={r.id === selected ? "active" : ""}>
                {r.preprocess?.contactSheet ? (
                  <img
                    src={fileUrl(`${r.dir}/${r.preprocess.contactSheet}`)}
                    alt=""
                    loading="lazy"
                  />
                ) : null}
                <span>
                  <strong>{r.doc.title}</strong>
                  <small className="muted">
                    {r.doc.probe ? `${r.doc.probe.duration.toFixed(1)}s · ` : ""}
                    {r.analysis ? "analyzed" : "not analyzed"}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
        {current ? (
          <ReferenceDetail reference={current} />
        ) : (
          <p className="muted">Select a reference.</p>
        )}
      </div>
    </section>
  );
}

function ReferenceDetail({ reference: r }: { reference: Reference }) {
  const [copied, setCopied] = useState(false);
  const prompt = `Use the content-factory tools to analyze reference "${r.id}": look at its contact sheet and hook frames, then save the analysis with save_reference_analysis.`;
  return (
    <div className="ref-detail">
      <div className="panel-head">
        <h2>{r.doc.title}</h2>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : r.analysis ? "Copy re-analysis prompt" : "Copy analysis prompt"}
        </button>
      </div>
      {r.doc.source ? (
        <p className="muted">
          <a href={r.doc.source} target="_blank" rel="noreferrer">
            {r.doc.source}
          </a>
        </p>
      ) : null}
      <div className="ref-media">
        {r.doc.video ? (
          <video src={fileUrl(`${r.dir}/${r.doc.video}`)} controls playsInline />
        ) : null}
        {r.preprocess?.contactSheet ? (
          <img src={fileUrl(`${r.dir}/${r.preprocess.contactSheet}`)} alt="Contact sheet" />
        ) : null}
      </div>
      {r.preprocess ? (
        <p className="muted">
          {r.preprocess.cuts.length} cuts · {r.preprocess.frames.length} frames
          {r.preprocess.notes.map((n) => (
            <span key={n}> · {n}</span>
          ))}
        </p>
      ) : null}
      {r.analysis ? (
        <pre className="doc">{r.analysis}</pre>
      ) : (
        <p className="muted">No analysis yet. Ask your agent with the prompt above.</p>
      )}
    </div>
  );
}
