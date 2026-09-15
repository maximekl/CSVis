import path from "node:path";
import type { Disposable, FileSystemWatcher, Uri } from "vscode";

import type { CsvOptions, HostToWebviewMessage } from "../shared/protocol";
import { CsvSession } from "./csvSession";

const RELOAD_DEBOUNCE_MS = 120;
type FileStatusMessage = Extract<
  HostToWebviewMessage,
  { readonly type: "fileStatus" }
>;

export class CsvFileMonitor implements Disposable {
  private readonly subscriptions: Disposable[];
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  public constructor(
    private readonly session: CsvSession,
    private readonly watcher: FileSystemWatcher,
    private readonly getOptions: () => CsvOptions,
    private readonly notify: (message: FileStatusMessage) => void,
  ) {
    this.subscriptions = [
      watcher.onDidChange((uri) => this.handleReloadEvent(uri)),
      watcher.onDidCreate((uri) => this.handleReloadEvent(uri)),
      watcher.onDidDelete((uri) => this.handleDeleteEvent(uri)),
    ];
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelReload();

    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }

    this.watcher.dispose();
  }

  private handleReloadEvent(uri: Uri): void {
    if (this.disposed || !this.isTarget(uri)) {
      return;
    }

    const revision = this.session.invalidateFile("reloading");
    this.notify({ type: "fileStatus", status: "reloading", revision });
    this.cancelReload();
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload(revision);
    }, RELOAD_DEBOUNCE_MS);
  }

  private handleDeleteEvent(uri: Uri): void {
    if (this.disposed || !this.isTarget(uri)) {
      return;
    }

    this.cancelReload();
    const revision = this.session.invalidateFile("missing");
    this.notify({
      type: "fileStatus",
      status: "missing",
      revision,
      message: "CSV file was deleted. Waiting for it to be recreated.",
    });
  }

  private async reload(revision: number): Promise<void> {
    if (this.disposed || revision !== this.session.currentFileRevision) {
      return;
    }

    try {
      const outcome = await this.session.reloadFile(this.getOptions(), revision);

      if (
        this.disposed ||
        outcome === undefined ||
        outcome.revision !== this.session.currentFileRevision
      ) {
        return;
      }

      this.notify({ type: "fileStatus", ...outcome });
    } catch (error: unknown) {
      if (!this.disposed && revision === this.session.currentFileRevision) {
        this.notify({
          type: "fileStatus",
          status: "error",
          revision,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private cancelReload(): void {
    if (this.reloadTimer !== undefined) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
  }

  private isTarget(uri: Uri): boolean {
    const actual = path.resolve(uri.fsPath);
    const expected = path.resolve(this.session.uri.fsPath);
    return process.platform === "linux"
      ? actual === expected
      : actual.toLowerCase() === expected.toLowerCase();
  }
}
