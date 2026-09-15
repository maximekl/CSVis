import type { WebviewState } from "./state";
import { DataGrid } from "./grid/DataGrid";
import { SqlConsole, type QueryConsoleActions } from "./SqlConsole";

export interface AppProps {
  readonly state: WebviewState;
  readonly actions?: QueryConsoleActions;
}

const NOOP_ACTIONS: QueryConsoleActions = {
  onQueryTextChange: () => undefined,
  onRunQuery: () => undefined,
  onPreviousPage: () => undefined,
  onNextPage: () => undefined,
};

export function App({ state, actions = NOOP_ACTIONS }: AppProps): React.JSX.Element {
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
      </header>
      <SqlConsole state={state} actions={actions} />
      {state.result !== undefined ? (
        <section aria-label="CSV preview">
          <h2>Preview ready</h2>
          <p className="muted">
            {state.result.rows.length} rows · {state.result.columns.length}{" "}
            columns
          </p>
          <DataGrid result={state.result} />
        </section>
      ) : (
        state.pendingRequestId !== undefined && (
          <p role="status" aria-live="polite">Loading CSV preview…</p>
        )
      )}
    </main>
  );
}
