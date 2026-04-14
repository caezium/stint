/**
 * Decode Arrow IPC binary (File format) into typed arrays.
 * Uses the already-installed `apache-arrow` package.
 */
import { tableFromIPC } from "apache-arrow";

export interface ResampledData {
  /** Timecodes in milliseconds (session-absolute) */
  timecodes: Float64Array;
  /** Channel name → dense value array */
  channels: Record<string, Float64Array>;
  /** Number of rows */
  rowCount: number;
}

/**
 * Decode an Arrow IPC binary response into typed arrays.
 * The table is expected to have a "timecodes" column plus N value columns.
 */
export function decodeArrowIPC(buffer: ArrayBuffer): ResampledData {
  const table = tableFromIPC(new Uint8Array(buffer));

  const timecodes = new Float64Array(table.numRows);
  const tcCol = table.getChild("timecodes");
  if (tcCol) {
    for (let i = 0; i < table.numRows; i++) {
      timecodes[i] = Number(tcCol.get(i));
    }
  }

  const channels: Record<string, Float64Array> = {};
  for (const field of table.schema.fields) {
    if (field.name === "timecodes") continue;
    const col = table.getChild(field.name);
    if (!col) continue;
    const arr = new Float64Array(table.numRows);
    for (let i = 0; i < table.numRows; i++) {
      arr[i] = Number(col.get(i));
    }
    channels[field.name] = arr;
  }

  return { timecodes, channels, rowCount: table.numRows };
}
