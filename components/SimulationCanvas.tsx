"use client";

import { useEffect } from "react";
import { motion, AnimatePresence, useAnimationControls } from "framer-motion";
import { ANIMATION_REGISTRY, is2DPos } from "@/lib/animation-registry";
import type { SolutionStep } from "@/lib/store";

interface Props {
  active: boolean;
  step: SolutionStep | undefined;
  stepKey: number; // changes when step changes → forces clean remount
  currentStep: number;
  allSteps: SolutionStep[];
  domains: string[];
  knowns: Record<string, number>;
  problem: string;
  isPlaying: boolean;
}

export default function SimulationCanvas({ active, step, stepKey, currentStep, allSteps, domains, knowns, problem, isPlaying }: Props) {
  const controls = useAnimationControls();

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
  const isFreezeStep = t_end === 0;
  const isStatic = isFreezeStep || animations.length === 0;
  const frozenPosition = getFrozenPosition(currentStep, allSteps);

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

  useEffect(() => {
    if (!active || !step) return;

    const baseState = {
      x: 0,
      y: 0,
      rotate: 0,
      opacity: 1,
    };

    if (isFreezeStep) {
      controls.set({
        x: frozenPosition.x,
        y: -frozenPosition.y,
        rotate: frozenPosition.rotate,
        opacity: 1,
      });
      return;
    }

    if (!isPlaying) {
      controls.set(baseState);
      return;
    }

    controls.start({
      x: targetX,
      y: -targetY,
      rotate: targetRotate,
      opacity: 1,
      transition: {
        duration: isStatic ? 0.3 : t_end,
        ease: primaryAnim?.type === "harmonic" ? [0.4, 0, 0.6, 1] : "easeInOut",
      },
    });
  }, [active, stepKey, isPlaying, targetX, targetY, targetRotate, t_end, isStatic, primaryAnim?.type, controls]);

  return (
    <div
      key={stepKey}
      className="w-full h-full relative overflow-hidden flex items-center justify-center"
    >
      {/* Ground line */}
      <div className="absolute bottom-12 left-0 w-full h-px bg-slate-700" />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <svg width="240" height="240" viewBox="-120 -120 240 240" className="overflow-visible">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="6"
              markerHeight="6"
              refX="0"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L6,3 Z" fill="currentColor" />
            </marker>
          </defs>

          {renderSceneGeometry(domains, knowns, problem)}
          {renderValueLabels(knowns, domains, isFreezeStep, step)}

          <AnimatePresence>
            <motion.g
              key={`obj-${stepKey}`}
              initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
              animate={controls}
            >
              {renderObject(step, primaryAnim?.type)}
            </motion.g>
          </AnimatePresence>
        </svg>
      </div>

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

function getFrozenPosition(stepIndex: number, allSteps: SolutionStep[]) {
  for (let idx = stepIndex - 1; idx >= 0; idx--) {
    const prevStep = allSteps[idx];
    const prevSim = prevStep.simulation_state;
    const prevAnim = prevSim.animations?.[0];
    const prevDuration = prevSim.time_range?.[1] ?? 0;

    if (prevDuration <= 0 || !prevAnim) continue;
    const fn = ANIMATION_REGISTRY[prevAnim.type];
    if (!fn) continue;

    const result = fn(prevDuration, prevAnim.params);
    if (is2DPos(result)) {
      return { x: result.x, y: result.y, rotate: 0 };
    }

    if (prevAnim.type === "rotate") {
      return { x: 0, y: 0, rotate: result as number };
    }

    return {
      x: Math.min(Math.max(result as number, -300), 300),
      y: 0,
      rotate: 0,
    };
  }

  return { x: 0, y: 0, rotate: 0 };
}

function renderSceneGeometry(domains: string[], knowns: Record<string, number>, problem: string): React.ReactElement | null {
  const hasIncline = domains.includes("incline");
  const hasCentripetal = domains.includes("centripetal");
  const hasShm = domains.includes("shm");
  if (!hasIncline && !hasCentripetal && !hasShm) return null;

  const inclineAngle = knowns.angle ?? knowns.theta ?? extractAngle(problem) ?? 30;
  const inclineHeight = knowns.h ?? extractHeight(problem) ?? 2;
  const springK = knowns.k ?? extractSpringConstant(problem);

  const baseY = 80;
  const halfWidth = 100;
  const inclineRadians = (inclineAngle * Math.PI) / 180;
  const bottomLeftX = -halfWidth;
  const bottomLeftY = baseY;
  const topLeftX = 0;
  const topLeftY = baseY - halfWidth * Math.tan(inclineRadians);
  const bottomRightX = halfWidth;
  const bottomRightY = baseY;
  const arcRadius = 18;
  const arcX = bottomLeftX + arcRadius * Math.cos(inclineRadians);
  const arcY = bottomLeftY - arcRadius * Math.sin(inclineRadians);

  return (
    <g>
      {hasIncline && (
        <g>
          <polygon
            points={`${bottomLeftX},${bottomLeftY} ${bottomRightX},${bottomRightY} ${topLeftX},${topLeftY}`}
            fill="#747474"
            stroke="#4b4b4b"
            strokeWidth="2"
            opacity="0.9"
          />
          <path
            d={`M${bottomLeftX},${bottomLeftY} L${bottomLeftX + 32},${bottomLeftY} A${arcRadius},${arcRadius} 0 0,1 ${arcX},${arcY}`}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="1"
          />
          <line
            x1={bottomRightX}
            y1={bottomRightY}
            x2={bottomRightX}
            y2={bottomRightY - 50}
            stroke="#e2e8f0"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
        </g>
      )}

      {hasCentripetal && (
        <g>
          <circle cx="0" cy="0" r="90" fill="none" stroke="#e2e8f0" strokeDasharray="4 4" strokeWidth="1" />
          <line x1="0" y1="0" x2="70" y2="0" stroke="#e2e8f0" strokeWidth="1" />
        </g>
      )}

      {hasShm && (
        <g>
          <line x1="-120" y1="80" x2="120" y2="80" stroke="#e2e8f0" strokeWidth="1" />
          <path
            d="M-110,80 h20 l5,-20 l5,20 l5,-20 l5,20 l5,-20 l5,20 h20"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="2"
          />
        </g>
      )}
    </g>
  );
}

function renderValueLabels(
  knowns: Record<string, number>,
  domains: string[],
  isFreezeStep: boolean,
  step: SolutionStep
): React.ReactElement | null {
  const labels: React.ReactElement[] = [];
  const isIncline = domains.includes("incline");
  const isCentripetal = domains.includes("centripetal");
  const isShm = domains.includes("shm");
  const solvedLabel = isFreezeStep ? getSolvedValueLabel(step) : null;

  if (!isIncline && !isCentripetal && !isShm && !solvedLabel) return null;

  const labelProps = {
    fill: "#94a3b8",
    fontSize: 10,
    fontFamily: "monospace",
  } as const;
  const solvedProps = {
    fill: "#60a5fa",
    fontSize: 11,
    fontFamily: "monospace",
    fontWeight: 700 as const,
  };

  if (isIncline) {
    if (knowns.m !== undefined) {
      labels.push(
        <text key="incline-m" x={-20} y={10} {...labelProps}>
          {`m = ${knowns.m}kg`}
        </text>
      );
    }
    if (knowns.h !== undefined) {
      labels.push(
        <text key="incline-h" x={108} y={26} {...labelProps}>
          {`h = ${knowns.h}m`}
        </text>
      );
    }
    const angleValue = knowns.angle ?? knowns.theta;
    if (angleValue !== undefined) {
      labels.push(
        <text key="incline-theta" x={-56} y={64} {...labelProps}>
          {`θ = ${angleValue}°`}
        </text>
      );
    }
    labels.push(
      <text key="incline-g" x={80} y={100} fill="#94a3b8" fontSize={9} fontFamily="monospace">
        {`g = 9.81 m/s²`}
      </text>
    );
  }

  if (isCentripetal) {
    if (knowns.r !== undefined) {
      labels.push(
        <text key="centripetal-r" x={26} y={-6} {...labelProps}>
          {`r = ${knowns.r}m`}
        </text>
      );
    }
    if (knowns.m !== undefined) {
      labels.push(
        <text key="centripetal-m" x={44} y={6} {...labelProps}>
          {`m = ${knowns.m}kg`}
        </text>
      );
    }
    const velocity = knowns.v ?? knowns.v_f ?? knowns.v0;
    if (velocity !== undefined) {
      labels.push(
        <text key="centripetal-v" x={30} y={-22} {...labelProps}>
          {`v = ${velocity} m/s`}
        </text>
      );
    }
  }

  if (isShm) {
    if (knowns.k !== undefined) {
      labels.push(
        <text key="shm-k" x={-36} y={52} {...labelProps}>
          {`k = ${knowns.k} N/m`}
        </text>
      );
    }
    if (knowns.A !== undefined) {
      labels.push(
        <text key="shm-A" x={-10} y={72} {...labelProps}>
          {`A = ${knowns.A}m`}</text>
      );
      labels.push(
        <line key="shm-A-line" x1={-knowns.A * 20} y1={78} x2={knowns.A * 20} y2={78} stroke="#94a3b8" strokeWidth="1" />
      );
    }
    if (knowns.m !== undefined) {
      labels.push(
        <text key="shm-m" x={12} y={44} {...labelProps}>
          {`m = ${knowns.m}kg`}
        </text>
      );
    }
  }

  if (solvedLabel) {
    labels.push(
      <text key="solved" x={0} y={-60} {...solvedProps} textAnchor="middle">
        {solvedLabel}
      </text>
    );
  }

  return <g>{labels}</g>;
}

function getSolvedValueLabel(step: SolutionStep): string | null {
  const match = step.math_latex.match(/([a-zA-Z]+)\s*=\s*([0-9]+\.?[0-9]*)/);
  if (match) {
    return `${match[1]} = ${match[2]}`;
  }
  if (step.concept) {
    return step.concept;
  }
  return null;
}

function extractAngle(problem: string): number | null {
  const match = problem.match(/(\d+\.?\d*)\s*(?:°|deg)/i);
  return match ? Number(match[1]) : null;
}

function extractHeight(problem: string): number | null {
  const match = problem.match(/h\s*=\s*(\d+\.?\d*)|height.*?(\d+\.?\d*)/i);
  if (!match) return null;
  return Number(match[1] ?? match[2]);
}

function extractSpringConstant(problem: string): number | null {
  const match = problem.match(/k\s*=\s*(\d+\.?\d*)/i);
  return match ? Number(match[1]) : null;
}

/** Render the appropriate SVG shape based on animation type */
function renderObject(step: SolutionStep, animType?: string): React.ReactElement {
  const shapes: Record<string, React.ReactElement> = {
    rotate: (
      <g>
        <circle cx="0" cy="0" r="48" fill="none" stroke="#3b82f6" strokeWidth="3" />
        <line x1="0" y1="0" x2="38" y2="0" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
        <circle cx="0" cy="0" r="4" fill="#60a5fa" />
      </g>
    ),
    circular: (
      <g>
        <circle cx="0" cy="0" r="32" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
      </g>
    ),
    harmonic: (
      <g>
        <rect x="-25" y="-25" width="50" height="50" rx="6" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
        <line x1="0" y1="-30" x2="0" y2="-20" stroke="#94a3b8" strokeWidth="2" strokeDasharray="2 2" />
      </g>
    ),
    default: (
      <g>
        <rect x="-38" y="-28" width="76" height="56" rx="6" fill="#3b82f6" className="drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
        <text x="0" y="4" textAnchor="middle" fill="white" fontSize="9" fontFamily="monospace" fontWeight="bold">OBJ</text>
      </g>
    ),
  };

  return shapes[animType ?? "default"] ?? shapes.default;
}
