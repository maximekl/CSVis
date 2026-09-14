import type { CustomDocument, Uri } from "vscode";

import { CsvSession } from "./csvSession";

type CsvSessionFactory = (uri: Uri) => Promise<CsvSession>;

interface SessionEntry {
  readonly promise: Promise<CsvSession>;
  references: number;
  session?: CsvSession;
  disposed: boolean;
}

export class CsvCustomDocument implements CustomDocument {
  private disposed = false;

  public constructor(
    public readonly uri: Uri,
    public readonly session: CsvSession,
    private readonly release: () => void,
  ) {}

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.release();
  }
}

export class CsvSessionManager {
  private readonly entries = new Map<string, SessionEntry>();
  private disposed = false;

  public constructor(
    private readonly createSession: CsvSessionFactory = CsvSession.create,
  ) {}

  public get activeSessionCount(): number {
    return this.entries.size;
  }

  public async open(uri: Uri): Promise<CsvCustomDocument> {
    if (this.disposed) {
      throw new Error("CSV session manager has been disposed");
    }

    const key = uri.toString();
    let entry = this.entries.get(key);

    if (entry === undefined) {
      entry = this.createEntry(uri);
      this.entries.set(key, entry);
    }

    entry.references += 1;

    try {
      const session = await entry.promise;

      if (this.disposed || entry.disposed) {
        throw new Error("CSV session manager has been disposed");
      }

      return new CsvCustomDocument(uri, session, () => {
        this.release(key, entry);
      });
    } catch (error: unknown) {
      this.release(key, entry);
      throw error;
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const entry of this.entries.values()) {
      this.disposeEntry(entry);
    }

    this.entries.clear();
  }

  private createEntry(uri: Uri): SessionEntry {
    const entry: SessionEntry = {
      promise: Promise.resolve().then(() => this.createSession(uri)),
      references: 0,
      disposed: false,
    };

    void entry.promise.then(
      (session) => {
        entry.session = session;

        if (entry.disposed) {
          session.dispose();
        }
      },
      () => undefined,
    );

    return entry;
  }

  private release(key: string, entry: SessionEntry): void {
    entry.references -= 1;

    if (entry.references > 0) {
      return;
    }

    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }

    this.disposeEntry(entry);
  }

  private disposeEntry(entry: SessionEntry): void {
    if (entry.disposed) {
      return;
    }

    entry.disposed = true;

    if (entry.session !== undefined) {
      entry.session.dispose();
    }
  }
}
