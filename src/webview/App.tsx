import type { WebviewState } from "./state";
import { DataGrid } from "./grid/DataGrid";

export interface AppProps {
  readonly state: WebviewState;
}

export function App({ state }: AppProps): React.JSX.Element {
  if (state.status === "loading") {
    return (
      <main className="app-shell" role="status" aria-live="polite">
        <h1>CSVis</h1>
        <p>Loading CSV preview…</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header>
        <h1>{state.fileName}</h1>
        <p className="muted">{state.initialQuery}</p>
      </header>
      {state.error !== undefined ? (
        <p role="alert">{state.error}</p>
      ) : state.result !== undefined ? (
        <section aria-label="CSV preview">
          <h2>Preview ready</h2>
          <p className="muted">
            {state.result.rows.length} rows · {state.result.columns.length}{" "}
            columns
          </p>
          <DataGrid result={state.result} />
        </section>
      ) : (
        <p role="status" aria-live="polite">Loading CSV preview…</p>
      )}
    </main>
  );
}
