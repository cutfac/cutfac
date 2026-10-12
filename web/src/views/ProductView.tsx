import { api, fileUrl } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { ImportForm } from "./Setup.tsx";

export function ProductView() {
  const { data: ws, error } = useLive(api.workspace);
  if (error) return <p className="error">{error}</p>;
  if (!ws) return <p className="muted">Loading…</p>;
  const product = ws.product.doc;

  return (
    <section className="narrow">
      <div className="toolbar">
        <h1>{product?.name ?? "Product"}</h1>
      </div>
      {product ? (
        <>
          <p className="lead">{product.oneLiner}</p>
          <dl>
            <dt>Audience</dt>
            <dd>{product.audience}</dd>
            <dt>Default CTA</dt>
            <dd>{product.cta.default}</dd>
          </dl>
          {product.rules.length ? (
            <>
              <h2>Rules</h2>
              <ul>
                {product.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <p className="muted">
          No product file yet. Fill in <code>product/product.yaml</code> — every agent run reads it.
        </p>
      )}
      <h2>Import from a link</h2>
      <p className="muted">
        Fills empty fields and refreshes store screenshots. Your edits to product.yaml are kept.
      </p>
      <ImportForm />
      {ws.product.store.length ? (
        <>
          <h2>Store listing</h2>
          <div className="captures">
            {ws.product.store
              .filter((m) => m.kind === "image")
              .map((m) => (
                <img
                  key={m.name}
                  src={fileUrl(`${ws.config.paths.product}/store/${m.name}`)}
                  alt={m.name}
                  loading="lazy"
                />
              ))}
          </div>
        </>
      ) : null}
      <h2>App captures</h2>
      {ws.product.captures.length ? (
        <div className="captures">
          {ws.product.captures.map((m) =>
            m.kind === "image" ? (
              <img
                key={m.name}
                src={fileUrl(`${ws.config.paths.product}/captures/${m.name}`)}
                alt={m.name}
                loading="lazy"
              />
            ) : (
              <video
                key={m.name}
                src={fileUrl(`${ws.config.paths.product}/captures/${m.name}`)}
                controls
                muted
              />
            ),
          )}
        </div>
      ) : (
        <p className="muted">Add reviewed screenshots or screen recordings to product/captures/.</p>
      )}
      <h2>Formats</h2>
      {ws.formats.length ? (
        <ul>
          {ws.formats.map((f) => (
            <li key={f.id}>
              <strong>{f.doc.title}</strong> — {f.doc.summary}{" "}
              {f.doc.references.map((r) => (
                <a key={r} href={href("references", r)} className="muted">
                  {" "}
                  [{r}]
                </a>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No formats yet. Analyze a reference and ask your agent to save one.</p>
      )}
    </section>
  );
}
