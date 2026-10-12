import { api } from "./api.ts";
import { href, useHashRoute, useLive } from "./hooks.ts";
import { Board } from "./views/Board.tsx";
import { Calendar } from "./views/Calendar.tsx";
import { ItemView } from "./views/ItemView.tsx";
import { ProductView } from "./views/ProductView.tsx";
import { References } from "./views/References.tsx";

const NAV = [
  ["board", "Board"],
  ["references", "References"],
  ["calendar", "Calendar"],
  ["product", "Product"],
] as const;

export function App() {
  const [view, id] = useHashRoute();
  const { data: ws, error } = useLive(api.workspace);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={href("board")}>
          {ws?.name ?? "Content Factory"}
        </a>
        <nav>
          {NAV.map(([key, label]) => (
            <a
              key={key}
              href={href(key)}
              className={view === key || (view === "item" && key === "board") ? "active" : ""}
            >
              {label}
              {key === "board" && ws && ws.openFeedback > 0 ? (
                <span className="count">{ws.openFeedback}</span>
              ) : null}
            </a>
          ))}
        </nav>
      </header>
      {error ? <p className="error">Cannot reach the factory server: {error}</p> : null}
      <main>{renderView(view, id)}</main>
    </div>
  );
}

function renderView(view: string, id: string | undefined) {
  if (view === "item" && id) return <ItemView id={id} />;
  if (view === "references") return <References selected={id} />;
  if (view === "calendar") return <Calendar />;
  if (view === "product") return <ProductView />;
  return <Board />;
}
