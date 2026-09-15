import type { KeyboardEvent } from "react";

import type { WebviewState } from "./state";

export interface QueryConsoleActions {
  readonly onQueryTextChange: (queryText: string) => void;
  readonly onRunQuery: () => void;
  readonly onPreviousPage: () => void;
  readonly onNextPage: () => void;
}

export interface SqlConsoleProps {
  readonly state: Extract<WebviewState, { readonly status: "ready" }>;
  readonly actions: QueryConsoleActions;
}

export function SqlConsole({
  state,
  actions,
}: SqlConsoleProps): React.JSX.Element {
  const pending = state.pendingRequestId !== undefined;
  const page = state.result?.page ?? state.page;
  const previousDisabled = pending || state.result === undefined || page === 0;
  const nextDisabled =
    pending || state.result === undefined || !state.result.hasNextPage;

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();

      if (!pending) {
        actions.onRunQuery();
      }
    }
  };

  return (
    <section className="sql-console" aria-label="SQL query console">
      <label className="sql-console-label" htmlFor="csvis-sql-query">
        SQL query
      </label>
      <textarea
        id="csvis-sql-query"
        className="sql-console-editor"
        value={state.queryText}
        rows={4}
        spellCheck={false}
        onChange={(event) => actions.onQueryTextChange(event.target.value)}
        onKeyDown={onEditorKeyDown}
      />
      <div className="sql-console-toolbar">
        <button
          type="button"
          className="sql-console-run"
          disabled={pending}
          onClick={actions.onRunQuery}
        >
          {pending ? "Running…" : "Run query"}
        </button>
        <span className="sql-console-hint">Cmd/Ctrl+Enter</span>
        <div className="sql-console-pagination" aria-label="Pagination">
          <button
            type="button"
            disabled={previousDisabled}
            onClick={actions.onPreviousPage}
          >
            Previous
          </button>
          <span aria-live="polite">Page {page + 1}</span>
          <button
            type="button"
            disabled={nextDisabled}
            onClick={actions.onNextPage}
          >
            Next
          </button>
        </div>
      </div>
      {state.error !== undefined && (
        <p className="sql-console-error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
