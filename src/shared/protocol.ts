export type CsvDelimiter =
  | { readonly mode: "auto" }
  | { readonly mode: "manual"; readonly value: string };

export type CsvHeaderMode = "auto" | "present" | "absent";

export type CsvEncoding = "utf-8" | "utf-16" | "latin-1";

export interface CsvOptions {
  readonly delimiter: CsvDelimiter;
  readonly header: CsvHeaderMode;
  readonly encoding: CsvEncoding;
}

export type CsvFileStatus = "ready" | "reloading" | "missing" | "error";

export interface ColumnMetadata {
  readonly name: string;
  readonly type: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface QueryRequest {
  readonly requestId: string;
  readonly sql: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface QueryResult {
  readonly requestId: string;
  readonly columns: readonly ColumnMetadata[];
  readonly rows: readonly (readonly JsonValue[])[];
  readonly page: number;
  readonly pageSize: number;
  readonly hasNextPage: boolean;
}

export type WebviewToHostMessage =
  | { readonly type: "ready" }
  | { readonly type: "runQuery"; readonly request: QueryRequest }
  | {
      readonly type: "updateCsvOptions";
      readonly requestId: string;
      readonly options: CsvOptions;
    };

export type HostToWebviewMessage =
  | {
      readonly type: "initialize";
      readonly fileName: string;
      readonly options: CsvOptions;
      readonly initialQuery: string;
      readonly fileStatus?: CsvFileStatus;
      readonly fileRevision?: number;
      readonly fileMessage?: string;
    }
  | { readonly type: "queryResult"; readonly result: QueryResult }
  | {
      readonly type: "queryError";
      readonly requestId: string;
      readonly message: string;
    }
  | {
      readonly type: "csvOptionsUpdated";
      readonly options: CsvOptions;
      readonly requestId?: string;
    }
  | {
      readonly type: "csvOptionsError";
      readonly requestId: string;
      readonly message: string;
    }
  | {
      readonly type: "fileStatus";
      readonly status: CsvFileStatus;
      readonly revision: number;
      readonly message?: string;
    };
