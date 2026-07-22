import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { VoltammetryApp } from "@/components/VoltammetryApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voltametrias EI — Análise de voltametria cíclica" },
      {
        name: "description",
        content:
          "Ferramenta interativa para carregar arquivos CSV de voltametria cíclica, detectar picos anódicos e catódicos e exportar os dados ajustados.",
      },
      { property: "og:title", content: "Voltametrias EI" },
      {
        property: "og:description",
        content: "Análise e visualização de voltametria cíclica com detecção automática de picos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="min-h-screen bg-background" />;
  }
  return <VoltammetryApp />;
}
