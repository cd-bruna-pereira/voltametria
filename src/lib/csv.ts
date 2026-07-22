import Papa from "papaparse";

export interface SeriesPair {
  index: number;
  eColumn: string;
  iColumn: string;
  e: number[];
  i: number[];
}

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  pairs: SeriesPair[];
}

function normalizeNumeric(raw: string | undefined): number {
  if (raw == null) return NaN;
  const cleaned = String(raw).trim().replace(",", ".");
  if (cleaned === "") return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function parseCsv(text: string): ParsedCsv {
  // Try comma first, then semicolon, then tab — pick the one giving most columns.
  const candidates = [",", ";", "\t"];
  let best: Papa.ParseResult<Record<string, string>> | null = null;
  let bestCols = 0;
  for (const delim of candidates) {
    const res = Papa.parse<Record<string, string>>(text, {
      delimiter: delim,
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    const cols = res.meta.fields?.length ?? 0;
    if (cols > bestCols) {
      best = res;
      bestCols = cols;
    }
  }
  if (!best || !best.meta.fields) {
    throw new Error("Não foi possível interpretar o CSV.");
  }
  const columns = best.meta.fields;
  const rows = best.data;

  const pattern = /^(E|I)_(\d+)$/;
  const grouped = new Map<number, { E?: string; I?: string }>();
  for (const c of columns) {
    const m = pattern.exec(c.trim());
    if (!m) continue;
    const axis = m[1] as "E" | "I";
    const idx = Number(m[2]);
    const entry = grouped.get(idx) ?? {};
    entry[axis] = c;
    grouped.set(idx, entry);
  }

  const pairs: SeriesPair[] = [];
  const sortedIdx = [...grouped.keys()].sort((a, b) => a - b);
  for (const idx of sortedIdx) {
    const entry = grouped.get(idx)!;
    if (!entry.E || !entry.I) continue;
    const e: number[] = [];
    const i: number[] = [];
    for (const row of rows) {
      const eV = normalizeNumeric(row[entry.E]);
      const iV = normalizeNumeric(row[entry.I]);
      if (Number.isFinite(eV) && Number.isFinite(iV)) {
        e.push(eV);
        i.push(iV);
      }
    }
    if (e.length > 0) {
      pairs.push({ index: idx, eColumn: entry.E, iColumn: entry.I, e, i });
    }
  }

  return { columns, rows, pairs };
}
