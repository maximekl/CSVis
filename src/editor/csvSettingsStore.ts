import type { Memento, Uri } from "vscode";

import { DEFAULT_CSV_OPTIONS, parseCsvOptions } from "../csv/csvOptions";
import type { CsvOptions } from "../shared/protocol";

const SETTINGS_KEY_PREFIX = "csvis.csvOptions:";

export class CsvSettingsStore {
  public constructor(private readonly workspaceState: Memento) {}

  public get(uri: Uri): CsvOptions {
    const saved = this.workspaceState.get<unknown>(this.key(uri));

    if (saved === undefined) {
      return DEFAULT_CSV_OPTIONS;
    }

    try {
      return parseCsvOptions(saved);
    } catch {
      // A corrupt or obsolete value must not prevent the CSV from opening.
      return DEFAULT_CSV_OPTIONS;
    }
  }

  public async set(uri: Uri, options: CsvOptions): Promise<CsvOptions> {
    const validated = parseCsvOptions(options);
    await this.workspaceState.update(this.key(uri), validated);
    return validated;
  }

  private key(uri: Uri): string {
    return `${SETTINGS_KEY_PREFIX}${uri.toString()}`;
  }
}
