import { useEffect, useMemo, useState } from "react";
import type * as PlotlyTypes from "plotly.js";
import { Upload, Beaker, RotateCcw, Download, Pencil, ArrowRight, ArrowLeft, Check } from "lucide-react";

import { parseCsv, type SeriesPair, type ParsedCsv } from "@/lib/csv";
import { detectPeaks, nearestIndex, recomputePeak, type Peak } from "@/lib/peaks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlotlyChart } from "./PlotlyChart";
import { cn } from "@/lib/utils";

const DETECTION = {
  prominenceFrac: 0.10,
  relHeight: 0.90,
  distanceFrac: 0.05,
};


type PeakMap = Record<number, Peak[]>; // series index -> peaks
type EditState = { seriesIndex: number; peakId: string; step: "start" | "end" } | null;

const ANODIC_COLOR = "rgb(220, 38, 38)";
const CATHODIC_COLOR = "rgb(37, 99, 235)";
const ANODIC_FILL = "rgba(220, 38, 38, 0.18)";
const CATHODIC_FILL = "rgba(37, 99, 235, 0.18)";
const SERIES_PALETTE = [
  "#0f766e",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#b45309",
  "#1d4ed8",
];

export function VoltammetryApp() {
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [peaks, setPeaks] = useState<PeakMap>({});
  const [originalPeaks, setOriginalPeaks] = useState<PeakMap>({});
  const [edit, setEdit] = useState<EditState>(null);
  const [view, setView] = useState<"edit" | "matrix">("edit");

  // (Re)detect peaks whenever the file changes.
  useEffect(() => {
    if (!parsed) return;
    const next: PeakMap = {};
    for (const pair of parsed.pairs) {
      next[pair.index] = detectPeaks(pair.e, pair.i, {
        ...DETECTION,
        idPrefix: `s${pair.index}`,
      });
    }
    setPeaks(next);
    setOriginalPeaks(next);
    setEdit(null);
  }, [parsed]);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const p = parseCsv(text);
      if (p.pairs.length === 0) {
        setError("Nenhum par E_x / I_x foi encontrado no arquivo.");
        setParsed(null);
        return;
      }
      setParsed(p);
      setFileName(file.name);
      setSelected(p.pairs.map((pair) => pair.index));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao ler o CSV.");
    }
  };

  const pairsById = useMemo(() => {
    const map = new Map<number, SeriesPair>();
    parsed?.pairs.forEach((p) => map.set(p.index, p));
    return map;
  }, [parsed]);

  const toggleSeries = (idx: number) => {
    setSelected((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b)));
  };

  const resetPeaks = (idx: number) => {
    const original = originalPeaks[idx] ?? [];
    setPeaks((prev) => ({ ...prev, [idx]: original.map((p) => ({ ...p })) }));
    setEdit(null);
  };




  const handleChartClick = (seriesIndex: number, point: { x: number; y: number }) => {
    if (!edit || edit.seriesIndex !== seriesIndex) return;
    const pair = pairsById.get(seriesIndex);
    if (!pair) return;
    const idx = nearestIndex(pair.e, point.x);
    setPeaks((prev) => {
      const list = prev[seriesIndex] ?? [];
      const updated = list.map((p) => {
        if (p.id !== edit.peakId) return p;
        // Anódico: início = esquerda, fim = direita.
        // Catódico: início = direita, fim = esquerda.
        // O bound atualizado é decidido por (kind, step); recomputePeak normaliza a ordem.
        const targetsLeft =
          (p.kind === "anodic" && edit.step === "start") ||
          (p.kind === "cathodic" && edit.step === "end");
        const patched: Peak = targetsLeft
          ? { ...p, left: idx, eLeft: pair.e[idx], manual: true }
          : { ...p, right: idx, eRight: pair.e[idx], manual: true };
        return recomputePeak(patched, pair.e, pair.i);
      });
      return { ...prev, [seriesIndex]: updated };
    });
    setEdit((cur) => (cur ? { ...cur, step: cur.step === "start" ? "end" : "start" } : cur));
  };


  const overviewData: PlotlyTypes.Data[] = useMemo(() => {
    if (!parsed) return [];
    return parsed.pairs
      .filter((p) => selected.includes(p.index))
      .map((p, i) => ({
        x: p.e,
        y: p.i,
        mode: "lines",
        type: "scatter",
        name: `Voltametria ${p.index}`,
        line: { color: SERIES_PALETTE[i % SERIES_PALETTE.length], width: 2 },
      }));
  }, [parsed, selected]);

  const exportCsv = () => {
    if (!parsed) return;
    const rows = [["Grafico", "Tipo", "E_pico", "I_pico", "E_inicio", "E_fim", "Manual"]];
    for (const pair of parsed.pairs) {
      if (!selected.includes(pair.index)) continue;
      for (const p of peaks[pair.index] ?? []) {
        rows.push([
          String(pair.index),
          p.kind === "anodic" ? "Anódico" : "Catódico",
          String(p.ePeak),
          String(p.iPeak),
          String(p.eLeft),
          String(p.eRight),
          p.manual ? "sim" : "não",
        ]);
      }
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    downloadBlob(csv, "picos.csv", "text/csv");
  };

  const exportJson = () => {
    if (!parsed) return;
    const payload = parsed.pairs
      .filter((p) => selected.includes(p.index))
      .map((p) => ({
        grafico: p.index,
        picos: (peaks[p.index] ?? []).map((pk) => ({
          tipo: pk.kind === "anodic" ? "anodico" : "catodico",
          e_pico: pk.ePeak,
          i_pico: pk.iPeak,
          e_inicio: pk.eLeft,
          e_fim: pk.eRight,
          manual: pk.manual,
        })),
      }));
    downloadBlob(JSON.stringify(payload, null, 2), "picos.json", "application/json");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Beaker className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Voltametrias EI</h1>
            <p className="text-xs text-muted-foreground">Análise de voltametria cíclica com detecção de picos</p>
          </div>
          {parsed && (
            <div className="flex items-center gap-2">
              {view === "matrix" && (
                <Button variant="ghost" size="sm" onClick={() => setView("edit")}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportJson}>
                <Download className="mr-2 h-4 w-4" /> JSON
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {view === "edit" && (
          <UploadCard fileName={fileName} onFile={handleFile} error={error} />
        )}

        {parsed && view === "edit" && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Séries detectadas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {parsed.pairs.map((pair, i) => {
                    const active = selected.includes(pair.index);
                    return (
                      <button
                        key={pair.index}
                        onClick={() => toggleSeries(pair.index)}
                        className={cn(
                          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                          active
                            ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        )}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: SERIES_PALETTE[i % SERIES_PALETTE.length] }}
                        />
                        Voltametria {pair.index}
                        <span className="text-[10px] opacity-70">· {pair.e.length} pts</span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            

            {selected.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Visão geral</CardTitle>
                </CardHeader>
                <CardContent>
                  <PlotlyChart
                    data={overviewData}
                    height={520}
                    layout={{
                      xaxis: { title: { text: "Potencial (E)" } },
                      yaxis: { title: { text: "Corrente (I)" } },
                    }}
                  />
                </CardContent>
              </Card>
            )}

            <section className="space-y-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Gráficos individuais</h2>
                <p className="text-xs text-muted-foreground">Use o lápis para editar os limites de um pico</p>
              </div>

              {selected.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Selecione ao menos uma série para visualizar os gráficos individuais.
                </p>
              )}

              {parsed.pairs
                .filter((p) => selected.includes(p.index))
                .map((pair) => (
                  <IndividualChart
                    key={pair.index}
                    pair={pair}
                    peaks={peaks[pair.index] ?? []}
                    edit={edit}
                    onClick={(pt) => handleChartClick(pair.index, pt)}
                    onStartEdit={(peakId, step) =>
                      setEdit({ seriesIndex: pair.index, peakId, step })
                    }
                    onStopEdit={() => setEdit(null)}
                    onReset={() => resetPeaks(pair.index)}
                  />

                ))}
            </section>

            {selected.length > 0 && (
              <div className="flex flex-col items-end gap-2">
                {edit && (
                  <p className="text-xs text-destructive">
                    Há uma edição de pico em andamento. Clique em "Concluir" antes de avançar.
                  </p>
                )}
                <Button
                  size="lg"
                  onClick={() => {
                    if (edit) {
                      window.alert(
                        "As edições de picos ainda não foram concluídas. Finalize clicando em \"Concluir\" antes de avançar.",
                      );
                      return;
                    }
                    setView("matrix");
                  }}
                >
                  Avançar <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}

        {parsed && view === "matrix" && (
          <MatrixView parsed={parsed} peaks={peaks} selected={selected} />
        )}
      </main>
    </div>
  );
}

function UploadCard({
  fileName,
  onFile,
  error,
}: {
  fileName: string | null;
  onFile: (file: File) => void;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 py-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {fileName ?? "Carregue um arquivo CSV"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Colunas no formato E_x e I_x · Suporta vírgula, ponto e vírgula ou tab
            </p>
          </div>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}




function IndividualChart({
  pair,
  peaks,
  edit,
  onClick,
  onStartEdit,
  onStopEdit,
  onReset,
}: {
  pair: SeriesPair;
  peaks: Peak[];
  edit: EditState;
  onClick: (pt: { x: number; y: number }) => void;
  onStartEdit: (peakId: string, step: "start" | "end") => void;
  onStopEdit: () => void;
  onReset: () => void;

}) {
  const editingHere = edit?.seriesIndex === pair.index;

  const data: PlotlyTypes.Data[] = useMemo(() => {
    const traces: PlotlyTypes.Data[] = [
      {
        x: pair.e,
        y: pair.i,
        mode: "lines",
        type: "scatter",
        name: `Voltametria ${pair.index}`,
        line: { color: "#334155", width: 2 },
        hovertemplate: "E: %{x:.4g}<br>I: %{y:.4g}<extra></extra>",
      },
    ];
    for (const pk of peaks) {
      const left = Math.min(pk.left, pk.right);
      const right = Math.max(pk.left, pk.right);
      if (right <= left) continue;
      const xs = pair.e.slice(left, right + 1);
      const ys = pair.i.slice(left, right + 1);
      const iLeft = pair.i[left];
      const iRight = pair.i[right];
      const baseline = xs.map((_, k) => iLeft + ((iRight - iLeft) * k) / (xs.length - 1));
      const polyX = [...xs, ...xs.slice().reverse()];
      const polyY = [...ys, ...baseline.slice().reverse()];
      traces.push({
        x: polyX,
        y: polyY,
        fill: "toself",
        mode: "lines",
        line: { width: 0 },
        fillcolor: pk.kind === "anodic" ? ANODIC_FILL : CATHODIC_FILL,
        hoverinfo: "skip",
        showlegend: false,
      });
      // Contorno da curva do pico (segmento sobre a curva bruta) em vermelho/azul
      traces.push({
        x: xs,
        y: ys,
        mode: "lines",
        type: "scatter",
        line: { color: pk.kind === "anodic" ? ANODIC_COLOR : CATHODIC_COLOR, width: 2 },
        hoverinfo: "skip",
        showlegend: false,
      });
    }
    const anodics = peaks.filter((p) => p.kind === "anodic");
    const cathodics = peaks.filter((p) => p.kind === "cathodic");
    if (anodics.length) {
      traces.push({
        x: anodics.map((p) => p.ePeak),
        y: anodics.map((p) => p.iPeak),
        mode: "markers",
        type: "scatter",
        name: "Anódico",
        marker: { symbol: "x", size: 12, color: ANODIC_COLOR, line: { width: 2, color: ANODIC_COLOR } },
        hovertemplate: "Anódico<br>E: %{x:.4g}<br>I: %{y:.4g}<extra></extra>",
      });
    }
    if (cathodics.length) {
      traces.push({
        x: cathodics.map((p) => p.ePeak),
        y: cathodics.map((p) => p.iPeak),
        mode: "markers",
        type: "scatter",
        name: "Catódico",
        marker: { symbol: "x", size: 12, color: CATHODIC_COLOR, line: { width: 2, color: CATHODIC_COLOR } },
        hovertemplate: "Catódico<br>E: %{x:.4g}<br>I: %{y:.4g}<extra></extra>",
      });
    }
    return traces;
  }, [pair, peaks]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">Voltametria {pair.index}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {peaks.length} pico{peaks.length === 1 ? "" : "s"} · {pair.e.length} pontos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Resetar
          </Button>
        </div>

      </CardHeader>
      <CardContent className="space-y-4">
        {editingHere && (() => {
          const editingPeak = peaks.find((p) => p.id === edit!.peakId);
          const isAnodic = editingPeak?.kind === "anodic";
          const stepLabel = edit!.step === "start" ? "início" : "fim";
          const sideHint = isAnodic
            ? edit!.step === "start"
              ? "clique à esquerda"
              : "clique à direita"
            : edit!.step === "start"
              ? "clique à direita"
              : "clique à esquerda";
          return (
            <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span>
                  Defina o <strong>{stepLabel}</strong> do pico{" "}
                  <strong>{isAnodic ? "anódico" : "catódico"}</strong> — {sideHint}.
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {isAnodic
                    ? "Anódico: esquerda = início, direita = fim."
                    : "Catódico: direita = início, esquerda = fim."}
                </span>
              </div>
              <Button variant="default" size="sm" onClick={onStopEdit}>
                <Check className="mr-1 h-3.5 w-3.5" /> Concluir
              </Button>
            </div>
          );
        })()}

        <PlotlyChart
          data={data}
          height={420}
          onPlotClick={onClick}
          layout={{
            xaxis: { title: { text: "Potencial (E)" } },
            yaxis: { title: { text: "Corrente (I)" } },
            showlegend: peaks.length > 0,
          }}
        />

        {peaks.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">E do pico</TableHead>
                  <TableHead className="text-right">I do pico</TableHead>
                  <TableHead className="text-right">E início</TableHead>
                  <TableHead className="text-right">E fim</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peaks.map((p) => {
                  const isEditing = edit?.peakId === p.id;
                  return (
                    <TableRow key={p.id} className={cn(isEditing && "bg-primary/5")}>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "font-medium",
                            p.kind === "anodic"
                              ? "bg-red-100 text-red-700 hover:bg-red-100"
                              : "bg-blue-100 text-blue-700 hover:bg-blue-100",
                          )}
                        >
                          {p.kind === "anodic" ? "Anódico" : "Catódico"}
                        </Badge>
                        {p.manual && <span className="ml-2 text-[10px] text-muted-foreground">manual</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.ePeak.toFixed(4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.iPeak.toExponential(3)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.eLeft.toFixed(4)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.eRight.toFixed(4)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant={isEditing ? "default" : "ghost"}
                            size="sm"
                            onClick={() =>
                              isEditing ? onStopEdit() : onStartEdit(p.id, "start")
                            }
                            title="Editar limites do pico"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MatrixView({
  parsed,
  peaks,
  selected,
}: {
  parsed: ParsedCsv;
  peaks: PeakMap;
  selected: number[];
}) {
  const pairs = parsed.pairs.filter((p) => selected.includes(p.index));
  const n = pairs.length;
  // Aim for a roughly rectangular grid; prefer more cols than rows for typical labs.
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 12 ? 4 : Math.ceil(Math.sqrt(n));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Picos com linha de base descontada</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cada gráfico mostra apenas as áreas dos picos marcados, com a linha de base linear
          subtraída entre os limites de início e fim.
        </p>
      </CardHeader>
      <CardContent>
        {n === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma série selecionada.
          </p>
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {pairs.map((pair) => (
              <BaselineCorrectedChart
                key={pair.index}
                pair={pair}
                peaks={peaks[pair.index] ?? []}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BaselineCorrectedChart({ pair, peaks }: { pair: SeriesPair; peaks: Peak[] }) {
  const data = useMemo<PlotlyTypes.Data[]>(() => {
    const traces: PlotlyTypes.Data[] = [];

    // Full CV in blue (matplotlib "tab:blue" ~ #1f77b4)
    traces.push({
      x: pair.e,
      y: pair.i,
      mode: "lines",
      type: "scatter",
      line: { color: "#1f77b4", width: 1.5 },
      name: `Voltametria ${pair.index}`,
      hovertemplate: "E: %{x:.4g}<br>I: %{y:.4g}<extra></extra>",
      showlegend: true,
    });

    for (const pk of peaks) {
      const left = Math.min(pk.left, pk.right);
      const right = Math.max(pk.left, pk.right);
      if (right <= left) continue;
      const xs = pair.e.slice(left, right + 1);
      const ys = pair.i.slice(left, right + 1);
      const iLeft = pair.i[left];
      const iRight = pair.i[right];
      const baseline = xs.map((_, k) => iLeft + ((iRight - iLeft) * k) / (xs.length - 1));
      const corrected = ys.map((v, k) => v - baseline[k]);

      // Red highlight over the peak region on the raw curve
      traces.push({
        x: xs,
        y: ys,
        mode: "lines",
        type: "scatter",
        line: { color: "#d62728", width: 2 },
        hoverinfo: "skip",
        showlegend: false,
      });

      // Black baseline-subtracted trace
      traces.push({
        x: xs,
        y: corrected,
        mode: "lines",
        type: "scatter",
        line: { color: "#111111", width: 1.5 },
        hovertemplate: "E: %{x:.4g}<br>Δi: %{y:.4g}<extra></extra>",
        showlegend: false,
      });
    }
    return traces;
  }, [pair, peaks]);

  return (
    <div className="rounded border border-border bg-white p-1">
      <PlotlyChart
        data={data}
        height={240}
        layout={{
          margin: { l: 44, r: 10, t: 10, b: 34 },
          paper_bgcolor: "#ffffff",
          plot_bgcolor: "#ffffff",
          font: { family: "DejaVu Sans, Arial, sans-serif", size: 11, color: "#222" },
          xaxis: {
            showgrid: false,
            zeroline: false,
            showline: true,
            linecolor: "#222",
            ticks: "outside",
            tickcolor: "#222",
            mirror: false,
          },
          yaxis: {
            showgrid: false,
            zeroline: false,
            showline: true,
            linecolor: "#222",
            ticks: "outside",
            tickcolor: "#222",
            mirror: false,
          },
          showlegend: true,
          legend: {
            x: 0.98,
            y: 0.98,
            xanchor: "right",
            yanchor: "top",
            bgcolor: "rgba(255,255,255,0.85)",
            bordercolor: "#222",
            borderwidth: 1,
            font: { size: 10 },
          },
        }}
      />
    </div>
  );
}


function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
