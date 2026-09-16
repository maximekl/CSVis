import { useEffect, useState } from "react";

import type { CsvOptions } from "../shared/protocol";
import type { WebviewState } from "./state";

export interface CsvSettingsActions {
  readonly onApplyCsvOptions: (options: CsvOptions) => void;
}

export interface CsvSettingsPanelProps {
  readonly state: Extract<WebviewState, { readonly status: "ready" }>;
  readonly actions: CsvSettingsActions;
}

export function CsvSettingsPanel({
  state,
  actions,
}: CsvSettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<CsvOptions>(state.options);

  useEffect(() => {
    setDraft(state.options);
  }, [state.options]);

  const pending = state.pendingSettingsRequestId !== undefined;
  const unavailable = state.fileStatus !== "ready";
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.options);

  return (
    <details className="csv-settings">
      <summary className="csv-settings-summary">CSV settings</summary>
      <div className="csv-settings-content">
        <form
          className="csv-settings-form"
          onSubmit={(event) => {
            event.preventDefault();

            if (dirty && !pending && !unavailable) {
              actions.onApplyCsvOptions(draft);
            }
          }}
        >
          <div className="csv-settings-field">
            <label htmlFor="csvis-delimiter-mode">Delimiter</label>
            <select
              id="csvis-delimiter-mode"
              value={draft.delimiter.mode}
              disabled={pending || unavailable}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  delimiter:
                    event.target.value === "manual"
                      ? {
                          mode: "manual",
                          value:
                            draft.delimiter.mode === "manual"
                              ? draft.delimiter.value
                              : ",",
                        }
                      : { mode: "auto" },
                })
              }
            >
              <option value="auto">Auto-detect</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          {draft.delimiter.mode === "manual" && (
            <div className="csv-settings-field csv-settings-delimiter-value">
              <label htmlFor="csvis-delimiter-value">
                Delimiter character
              </label>
              <input
                id="csvis-delimiter-value"
                type="text"
                value={draft.delimiter.value}
                disabled={pending || unavailable}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    delimiter: { mode: "manual", value: event.target.value },
                  })
                }
              />
            </div>
          )}
          <div className="csv-settings-field">
            <label htmlFor="csvis-header-mode">Header row</label>
            <select
              id="csvis-header-mode"
              value={draft.header}
              disabled={pending || unavailable}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  header: event.target.value as CsvOptions["header"],
                })
              }
            >
              <option value="auto">Auto-detect</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
            </select>
          </div>
          <div className="csv-settings-field">
            <label htmlFor="csvis-encoding">Encoding</label>
            <select
              id="csvis-encoding"
              value={draft.encoding}
              disabled={pending || unavailable}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  encoding: event.target.value as CsvOptions["encoding"],
                })
              }
            >
              <option value="utf-8">UTF-8</option>
              <option value="utf-16">UTF-16</option>
              <option value="latin-1">Latin-1</option>
            </select>
          </div>
          <button type="submit" disabled={!dirty || pending || unavailable}>
            {pending ? "Applying…" : "Apply settings"}
          </button>
        </form>
        {state.settingsError !== undefined && (
          <p className="csv-settings-error" role="alert">
            {state.settingsError}
          </p>
        )}
      </div>
    </details>
  );
}
