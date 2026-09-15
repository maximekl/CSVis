import type { WebviewState } from "./state";
import { DataGrid } from "./grid/DataGrid";
import { SqlConsole, type QueryConsoleActions } from "./SqlConsole";
import { CsvSettingsPanel, type CsvSettingsActions } from "./CsvSettingsPanel";

type AppActions = QueryConsoleActions & CsvSettingsActions;

export interface AppProps {
  readonly state: WebviewState;
  readonly actions?: AppActions;
}

const NOOP_ACTIONS: AppActions = {
  onQueryTextChange: () => undefined,
  onRunQuery: () => undefined,
  onPreviousPage: () => undefined,
  onNextPage: () => undefined,
  onApplyCsvOptions: () => undefined,
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
      {state.fileStatus === "reloading" && (
        <p className="file-status" role="status" aria-live="polite">
          CSV file changed. Reloading…
        </p>
      )}
      {state.fileStatus === "missing" && (
        <p className="file-status file-status-error" role="alert">
          {state.fileMessage ?? "CSV file was deleted. Waiting for it to be recreated."}
        </p>
      )}
      {state.fileStatus === "error" && (
        <p className="file-status file-status-error" role="alert">
          CSV reload failed: {state.fileMessage ?? "Unknown error"}
        </p>
      )}
      <CsvSettingsPanel state={state} actions={actions} />
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
