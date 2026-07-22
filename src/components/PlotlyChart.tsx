import { useEffect, useRef } from "react";
import type * as PlotlyTypes from "plotly.js";

type PlotlyModule = typeof PlotlyTypes;
let plotlyPromise: Promise<PlotlyModule> | null = null;
function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyPromise) {
    plotlyPromise = import("plotly.js-dist-min").then(
      (m) => ((m as unknown as { default?: PlotlyModule }).default ?? (m as unknown as PlotlyModule)),
    );
  }
  return plotlyPromise;
}

namespace Plotly {
  export type Data = PlotlyTypes.Data;
  export type Layout = PlotlyTypes.Layout;
  export type Config = PlotlyTypes.Config;
  export type PlotMouseEvent = PlotlyTypes.PlotMouseEvent;
}

export interface PlotlyChartProps {
  data: Plotly.Data[];
  layout?: Partial<Plotly.Layout>;
  config?: Partial<Plotly.Config>;
  onPlotClick?: (point: { x: number; y: number }) => void;
  className?: string;
  height?: number;
}

export function PlotlyChart({
  data,
  layout,
  config,
  onPlotClick,
  className,
  height = 420,
}: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const clickRef = useRef(onPlotClick);
  clickRef.current = onPlotClick;

  useEffect(() => {
    let cancelled = false;
    let plotly: PlotlyModule | null = null;
    const node = ref.current;
    if (!node) return;

    loadPlotly().then((Plotly) => {
      if (cancelled || !ref.current) return;
      plotly = Plotly;
      const mergedLayout: Partial<Plotly.Layout> = {
        autosize: true,
        margin: { l: 50, r: 20, t: 30, b: 45 },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "'Inter', system-ui, sans-serif", size: 12, color: "#1f2937" },
        xaxis: { gridcolor: "#e5e7eb", zerolinecolor: "#d1d5db", ...(layout?.xaxis ?? {}) },
        yaxis: { gridcolor: "#e5e7eb", zerolinecolor: "#d1d5db", ...(layout?.yaxis ?? {}) },
        legend: { orientation: "h", y: -0.2 },
        ...layout,
      };
      Plotly.react(ref.current, data, mergedLayout, {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
        ...config,
      });
      const el = ref.current as unknown as {
        on: (evt: string, cb: (e: Plotly.PlotMouseEvent) => void) => void;
        removeAllListeners?: (evt: string) => void;
      };
      el.on("plotly_click", (e) => {
        if (!clickRef.current) return;
        const p = e.points?.[0];
        if (!p) return;
        clickRef.current({ x: Number(p.x), y: Number(p.y) });
      });
    });

    return () => {
      cancelled = true;
      if (plotly && node) plotly.purge(node);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layout, config]);

  return <div ref={ref} className={className} style={{ width: "100%", height }} />;
}
