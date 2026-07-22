// Port of scipy.signal find_peaks (prominence + distance) and peak_widths.

export type PeakKind = "anodic" | "cathodic";

export interface Peak {
  id: string;
  kind: PeakKind;
  index: number; // index into filtered arrays
  left: number;
  right: number;
  ePeak: number;
  iPeak: number;
  eLeft: number;
  eRight: number;
  manual: boolean;
}

function localMaxima(x: number[]): number[] {
  const peaks: number[] = [];
  const n = x.length;
  let i = 1;
  while (i < n - 1) {
    if (x[i - 1] < x[i]) {
      let iAhead = i + 1;
      while (iAhead < n - 1 && x[iAhead] === x[i]) iAhead++;
      if (x[iAhead] < x[i]) {
        peaks.push(Math.floor((i + iAhead - 1) / 2));
        i = iAhead;
      }
    }
    i++;
  }
  return peaks;
}

function peakProminences(x: number[], peaks: number[]): number[] {
  const proms: number[] = [];
  for (const p of peaks) {
    let iMin = 0;
    let iMax = x.length - 1;
    // left
    let leftMin = x[p];
    let i = p;
    while (i >= iMin && x[i] <= x[p]) {
      if (x[i] < leftMin) leftMin = x[i];
      i--;
    }
    // right
    let rightMin = x[p];
    let j = p;
    while (j <= iMax && x[j] <= x[p]) {
      if (x[j] < rightMin) rightMin = x[j];
      j++;
    }
    proms.push(x[p] - Math.max(leftMin, rightMin));
  }
  return proms;
}

function filterByDistance(peaks: number[], priority: number[], distance: number): number[] {
  const n = peaks.length;
  const keep = new Array(n).fill(true);
  // sort indices by priority desc
  const order = [...Array(n).keys()].sort((a, b) => priority[b] - priority[a]);
  for (const idx of order) {
    if (!keep[idx]) continue;
    for (let k = 0; k < n; k++) {
      if (k === idx || !keep[k]) continue;
      if (Math.abs(peaks[k] - peaks[idx]) < distance) keep[k] = false;
    }
  }
  return peaks.filter((_, i) => keep[i]);
}

function peakWidthAt(
  x: number[],
  peakIdx: number,
  relHeight: number,
  prominence: number,
): { left: number; right: number } {
  const height = x[peakIdx] - relHeight * prominence;
  // walk left
  let i = peakIdx;
  while (i > 0 && x[i] > height) i--;
  const leftIps = i + (x[i + 1] - x[i] === 0 ? 0 : (height - x[i]) / (x[i + 1] - x[i]));
  // walk right
  let j = peakIdx;
  while (j < x.length - 1 && x[j] > height) j++;
  const rightIps = j - 1 + (x[j] - x[j - 1] === 0 ? 0 : (height - x[j - 1]) / (x[j] - x[j - 1]));
  return {
    left: Math.max(0, Math.floor(leftIps)),
    right: Math.min(x.length - 1, Math.ceil(rightIps)),
  };
}

function detectSide(
  e: number[],
  i: number[],
  kind: PeakKind,
  prominence: number,
  distance: number,
  relHeight: number,
  idPrefix: string,
): Peak[] {
  const sign = kind === "anodic" ? 1 : -1;
  const y = i.map((v) => v * sign);
  const rawPeaks = localMaxima(y);
  const proms = peakProminences(y, rawPeaks);
  const filteredByProm: number[] = [];
  const filteredProms: number[] = [];
  rawPeaks.forEach((p, idx) => {
    if (proms[idx] >= prominence) {
      filteredByProm.push(p);
      filteredProms.push(proms[idx]);
    }
  });
  const kept = filterByDistance(filteredByProm, filteredProms, distance);
  const promMap = new Map(filteredByProm.map((p, idx) => [p, filteredProms[idx]]));

  return kept.map((idx, k) => {
    const prom = promMap.get(idx) ?? 0;
    let { left, right } = peakWidthAt(y, idx, relHeight, prom);
    if (left >= right) {
      left = Math.max(0, idx - 1);
      right = Math.min(y.length - 1, idx + 1);
    }
    return {
      id: `${idPrefix}-${kind}-${k}`,
      kind,
      index: idx,
      left,
      right,
      ePeak: e[idx],
      iPeak: i[idx],
      eLeft: e[left],
      eRight: e[right],
      manual: false,
    };
  });
}

export function detectPeaks(
  e: number[],
  i: number[],
  opts: { prominenceFrac: number; relHeight: number; distanceFrac: number; idPrefix: string },
): Peak[] {
  if (i.length < 5) return [];
  const finite = i.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const range = Math.max(...finite) - Math.min(...finite);
  if (!(range > 0)) return [];
  const prom = Math.max(opts.prominenceFrac * range, 1e-12);
  const dist = Math.max(1, Math.floor(i.length * opts.distanceFrac));
  return [
    ...detectSide(e, i, "anodic", prom, dist, opts.relHeight, opts.idPrefix),
    ...detectSide(e, i, "cathodic", prom, dist, opts.relHeight, opts.idPrefix),
  ];
}

/** Given a target E value, return the closest index in e[] (assumes monotonic-ish scan). */
export function nearestIndex(e: number[], value: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let k = 0; k < e.length; k++) {
    const d = Math.abs(e[k] - value);
    if (d < bestDiff) {
      bestDiff = d;
      best = k;
    }
  }
  return best;
}

/** Recompute peak position (max/min of i within [left,right]) after editing bounds. */
export function recomputePeak(peak: Peak, e: number[], i: number[]): Peak {
  const left = Math.min(peak.left, peak.right);
  const right = Math.max(peak.left, peak.right);
  const sign = peak.kind === "anodic" ? 1 : -1;
  let bestIdx = left;
  let bestVal = -Infinity;
  for (let k = left; k <= right; k++) {
    const v = i[k] * sign;
    if (v > bestVal) {
      bestVal = v;
      bestIdx = k;
    }
  }
  return {
    ...peak,
    left,
    right,
    index: bestIdx,
    ePeak: e[bestIdx],
    iPeak: i[bestIdx],
    eLeft: e[left],
    eRight: e[right],
  };
}
