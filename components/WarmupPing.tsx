"use client";

import { useState, useEffect } from "react";

type Status = "warming" | "ready" | "failed";

/**
 * WarmupPing — mounted in app/layout.tsx so it fires on EVERY page load.
 * Pre-warms the Railway/Render SymPy worker before the user interacts.
 *
 * Also renders a subtle status indicator so you can tell during testing
 * whether the worker is cold or warm — saves 20 minutes of debugging.
 */
export default function WarmupPing() {
  const [status, setStatus] = useState<Status>("warming");

  useEffect(() => {
    fetch("/api/warmup", { method: "GET" })
      .then(() => setStatus("ready"))
      .catch(() => setStatus("failed"));
  }, []);

  const indicators: Record<Status, { dot: string; label: string; bg: string }> = {
    warming: {
      dot: "animate-ping bg-yellow-400",
      label: "Math engine warming…",
      bg: "border-yellow-400/30 bg-yellow-950/40 text-yellow-300",
    },
    ready: {
      dot: "bg-green-400",
      label: "Math engine ready",
      bg: "border-green-500/30 bg-green-950/40 text-green-300",
    },
    failed: {
      dot: "bg-yellow-500",
      label: "Math engine unreachable",
      bg: "border-yellow-500/30 bg-yellow-950/40 text-yellow-300",
    },
  };

  const { dot, label, bg } = indicators[status];

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono backdrop-blur-sm transition-all duration-700 ${bg}`}
    >
      <span className="relative flex h-2 w-2">
        {status === "warming" && (
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dot}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${status !== "warming" ? dot : "bg-yellow-400"}`} />
      </span>
      {label}
    </div>
  );
}
