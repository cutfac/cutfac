import { useState } from "react";
import { api, type AgentStatus } from "../api.ts";
import { href, useLive } from "../hooks.ts";

const AGENT_LABEL: Record<AgentStatus["agent"], string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** First-run onboarding: connect an agent, then point the factory at the app. */
export function Setup() {
  const { data: agents, reload } = useLive(api.agents);
  const { data: ws } = useLive(api.workspace);
  const connected = agents?.some((a) => a.connected) ?? false;
  const hasProduct = Boolean(ws?.product.doc && ws.product.doc.name !== "My App");

  return (
    <section className="narrow setup">
      <div className="toolbar">
        <h1>Set up</h1>
      </div>
      <ol className="steps">
        <li className={connected ? "done" : "current"}>
          <h2>Connect your agent</h2>
          <p className="muted">
            Your agent does the production and editing. The factory gives it tools, files, and your
            feedback.
          </p>
          {agents ? (
            <ul className="agents">
              {agents.map((a) => (
                <AgentRow key={a.agent} status={a} onChange={reload} />
              ))}
            </ul>
          ) : (
            <p className="muted">Checking installed agents…</p>
          )}
        </li>
        <li className={hasProduct ? "done" : connected ? "current" : ""}>
          <h2>Tell it about your app</h2>
          <p className="muted">
            Paste an App Store, Google Play, or website link. Store links on your site are followed.
          </p>
          <ImportForm />
          {hasProduct ? (
            <p>
              <strong>{ws?.product.doc?.name}</strong> — {ws?.product.doc?.oneLiner}{" "}
              <a href={href("product")}>Review</a>
            </p>
          ) : null}
        </li>
      </ol>
      {connected && hasProduct ? (
        <p>
          You're set. Ask your agent to find a reference and make the first video, then review it on
          the <a href={href("board")}>board</a>.
        </p>
      ) : null}
    </section>
  );
}

function AgentRow({ status, onChange }: { status: AgentStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string>();
  const label = AGENT_LABEL[status.agent];
  return (
    <li>
      <strong>{label}</strong>
      {status.connected ? (
        <span className="ok">✓ Connected</span>
      ) : status.installed ? (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api.connectAgent(status.agent);
              setDetail(result.detail);
              onChange();
            } catch (err) {
              setDetail(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      ) : (
        <span className="muted">Not installed</span>
      )}
      {detail ? <small className="muted">{detail}</small> : null}
    </li>
  );
}

export function ImportForm() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim()) return;
        setBusy(true);
        setError(undefined);
        try {
          setNotes((await api.importProduct(url.trim())).warnings);
          setUrl("");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://apps.apple.com/… or https://yourapp.com"
        />
        <button type="submit" className="primary" disabled={busy || !url.trim()}>
          {busy ? "Reading…" : "Import"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notes.map((n) => (
        <p key={n} className="muted">
          {n}
        </p>
      ))}
    </form>
  );
}
