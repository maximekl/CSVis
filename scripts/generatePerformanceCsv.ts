import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HEADER = Buffer.from("id,label,payload\n");
const ROW = "1,alpha," + "x".repeat(96) + "\n";
const ROWS_PER_CHUNK = 8192;

export interface GeneratedCsvFixture {
  readonly byteLength: number;
  readonly rowCount: number;
}

export async function generatePerformanceCsv(
  filePath: string,
  targetBytes: number,
): Promise<GeneratedCsvFixture> {
  if (!Number.isSafeInteger(targetBytes) || targetBytes <= HEADER.length) {
    throw new RangeError("Target CSV size must exceed the header size");
  }

  const rowCount = Math.ceil((targetBytes - HEADER.length) / Buffer.byteLength(ROW));
  const fullChunk = Buffer.from(ROW.repeat(ROWS_PER_CHUNK));

  async function* chunks(): AsyncGenerator<Buffer> {
    yield HEADER;

    for (let remaining = rowCount; remaining > 0;) {
      const rows = Math.min(remaining, ROWS_PER_CHUNK);
      yield rows === ROWS_PER_CHUNK
        ? fullChunk
        : Buffer.from(ROW.repeat(rows));
      remaining -= rows;
    }
  }

  await pipeline(
    Readable.from(chunks()),
    createWriteStream(filePath, { flags: "wx" }),
  );

  return {
    byteLength: HEADER.length + rowCount * Buffer.byteLength(ROW),
    rowCount,
  };
}
