"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ANIMATION_REGISTRY, is2DPos } from "@/lib/animation-registry";
import type { SolutionStep } from "@/lib/store";

interface Props {
  active: boolean;
  step: SolutionStep | undefined;
  stepKey: number; // changes when step changes → forces clean remount
}

export default function SimulationCanvas({ active, step, stepKey }: Props) {
  const animFrameRef = useRef<number | null>(null);

  if (!active || !step) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-600 font-mono text-sm opacity-50">
        <div className="text-3xl">⚛</div>
        <div>[ Simulation Awaiting Input ]</div>
      </div>
    );
  }

  const sim = step.simulation_state;
  const animations = sim.animations ?? [];
  const vectors = sim.vectors ?? [];
  const t_end = sim.time_range?.[1] ?? 0;
  const isStatic = t_end === 0 || animations.length === 0;

  // Pick first animation to determine object motion from ANIMATION_REGISTRY
  const primaryAnim = animations[0];
  let targetX = 0;
  let targetY = 0;
  let targetRotate = 0;

  if (primaryAnim) {
    const fn = ANIMATION_REGISTRY[primaryAnim.type];
    if (fn) {
      const result = fn(t_end, primaryAnim.params);
      if (is2DPos(result)) {
        targetX = result.x;
        targetY = result.y;
      } else {
        // 1D: map to x displacement (polynomial/harmonic) or rotation
        if (primaryAnim.type === "rotate") {
          targetRotate = result as number;
        } else {
          // Clamp visual displacement to canvas width
          targetX = Math.min(Math.max(result as number, -300), 300);
        }
      }
    }
  }

  return (
    <div
      key={stepKey}
      className="w-full h-full relative overflow-hidden flex items-center justify-center"
    >
      {/* Ground line */}
      <div className="absolute bottom-12 left-0 w-full h-px bg-slate-700" />

      {/* Dynamic force vectors */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        {vectors.map((vec, i) => {
          const isUp = vec.direction[1] > 0;
          const isRight = vec.direction[0] > 0;
          return (
            <div
              key={i}
              className="flex items-center gap-1 text-xs font-mono font-bold"
              style={{ color: vec.color }}
            >
              <span>{isRight ? "→" : isUp ? "↑" : "↓"}</span>
              <span>{vec.label}</span>
            </div>
          );
        })}
      </div>

      {/* Animated Physics Object */}
      <AnimatePresence>
        <motion.div
          key={`obj-${stepKey}`}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
          animate={{
            x: targetX,
            y: -targetY, // SVG y-axis is inverted
            rotate: targetRotate,
            opacity: 1,
          }}
          transition={{
            duration: isStatic ? 0.3 : t_end,
            ease: primaryAnim?.type === "harmonic" ? [0.4, 0, 0.6, 1] : "easeInOut",
          }}
          className="relative z-10"
        >
          {renderObject(step, primaryAnim?.type)}
        </motion.div>
      </AnimatePresence>

      {/* HUD */}
      <div className="absolute top-3 right-3 bg-slate-950/80 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 backdrop-blur-sm">
        <div className="text-blue-400 font-bold mb-2 border-b border-slate-800 pb-1">
          {step.concept}
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-500">Domain</span>
          <span className="text-right capitalize">{primaryAnim?.type ?? "static"}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-slate-500">Duration</span>
          <span className="text-right">{isStatic ? "static" : `${t_end}s`}</span>
        </div>
        {primaryAnim && (
          <div className="flex justify-between gap-6 text-orange-400 mt-1">
            <span>f(t)</span>
            <span className="text-right">{primaryAnim.type}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Render the appropriate SVG shape based on animation type */
function renderObject(step: SolutionStep, animType?: string): React.ReactElement {
  const shapes: Record<string, React.ReactElement> = {
    rotate: (
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="36" fill="none" stroke="#3b82f6" strokeWidth="3" />
        <line x1="40" y1="40" x2="76" y2="40" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="40" cy="40" r="4" fill="#60a5fa" />
      </svg>
    ),
    circular: (
      <svg width="80" height="80" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r="12" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
      </svg>
    ),
    harmonic: (
      <svg width="60" height="60" viewBox="0 0 60 60">
        <rect x="10" y="10" width="40" height="40" rx="6" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
        <line x1="30" y1="0" x2="30" y2="10" stroke="#94a3b8" strokeWidth="2" strokeDasharray="2 2" />
      </svg>
    ),
    default: (
      <svg width="52" height="36" viewBox="0 0 52 36">
        <rect x="2" y="2" width="48" height="32" rx="6" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
        <text x="26" y="21" textAnchor="middle" fill="white" fontSize="9" fontFamily="monospace" fontWeight="bold">OBJ</text>
      </svg>
    ),
  };

  return shapes[animType ?? "default"] ?? shapes.default;
}
