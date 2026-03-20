"use client";

import { BlockMath } from "react-katex";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Play, SkipBack, SkipForward, AlertCircle } from "lucide-react";
import SimulationCanvas from "@/components/SimulationCanvas";
import { usePhysicsStore } from "@/lib/store";

export default function Home() {
  const {
    sceneDocument,
    setSceneDocument,
    clearScene,
    currentStep,
    setCurrentStep,
    stepForward,
    stepBack,
    isSolving,
    setIsSolving,
    error,
    setError,
  } = usePhysicsStore();

  const [problem, setProblem] = [
    usePhysicsStore(s => s.sceneDocument?.problem ?? ""),
    () => {},
  ];

  // Local problem text state (not stored in Zustand until solved)
  const handleSolve = async (problemText: string) => {
    if (!problemText.trim()) return;
    setIsSolving(true);
    clearScene();

    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: problemText }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? "An unknown error occurred.");
        return;
      }

      // ── Parallel Array Contract Guard ────────────────────────────────────────
      if (!data.solution_steps || data.solution_steps.length === 0) {
        setError("Backend returned empty solution — no steps to display.");
        return;
      }
      const allHaveSimState = data.solution_steps.every(
        (s: any) => s.simulation_state !== undefined
      );
      if (!allHaveSimState) {
        setError("Backend returned mismatched steps — one or more steps missing simulation_state.");
        return;
      }

      setSceneDocument(data);
    } catch {
      setError("Network error. Is the SymPy worker running?");
    } finally {
      setIsSolving(false);
    }
  };

  const steps = sceneDocument?.solution_steps ?? [];
  const activeStep = steps[currentStep];
  const isSolved = steps.length > 0;

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 overflow-hidden">

      {/* ── LEFT PANEL: Input & Solution Steps ─────────────────────────────── */}
      <div className="w-1/2 h-full flex flex-col border-r border-slate-200 bg-white shadow-sm z-10">

        {/* Header / Input */}
        <div className="p-6 border-b border-slate-100 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-1">
            PhysicsViz
          </h1>
          <p className="text-xs text-slate-400 mb-4">
            AP Physics C: Mechanics — step-by-step solutions with synchronized simulations
          </p>

          <ProblemInput
            isSolving={isSolving}
            onSolve={handleSolve}
          />

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Steps */}
        <ScrollArea className="flex-1 p-6">
          {isSolved && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
              {steps.map((step, idx) => {
                const isActive = currentStep === idx;
                return (
                  <div
                    key={`step-${step.step_id}`}   // keyed on step_id = clean KaTeX remount
                    onClick={() => setCurrentStep(idx)}
                    className={`border rounded-xl p-5 cursor-pointer transition-all ${
                      isActive
                        ? "bg-blue-50/60 border-blue-200 ring-1 ring-blue-500 shadow-sm"
                        : "bg-slate-50 border-slate-100 hover:border-blue-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                        isActive ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700"
                      }`}>
                        {step.step_id}
                      </span>
                      <h3 className={`font-semibold text-sm ${isActive ? "text-blue-900" : "text-slate-800"}`}>
                        {step.concept}
                      </h3>
                    </div>
                    <p className="text-sm text-slate-600 mb-3 leading-relaxed">{step.explanation}</p>
                    <div
                      key={`katex-${step.step_id}`}  // Forces clean KaTeX remount per step
                      className="bg-white p-4 rounded-lg border border-slate-100 flex justify-center overflow-x-auto"
                    >
                      <BlockMath math={step.math_latex} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── RIGHT PANEL: Simulation ─────────────────────────────────────────── */}
      <div className="w-1/2 h-full bg-slate-900 flex flex-col">

        {/* Canvas */}
        <div className="flex-1 overflow-hidden border-b border-slate-800 relative">
          <SimulationCanvas
            active={isSolved}
            step={activeStep}
            stepKey={currentStep}
          />
        </div>

        {/* Playback Bar */}
        <div className="h-20 bg-slate-950 flex items-center px-8 gap-4 shrink-0">
          <Button
            variant="outline" size="icon"
            onClick={stepBack}
            disabled={!isSolved || currentStep === 0}
            className="h-9 w-9 rounded-full bg-transparent border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          <Button
            size="icon"
            className="h-11 w-11 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/50 disabled:opacity-30"
            disabled={!isSolved}
          >
            <Play className="h-4 w-4 ml-0.5" />
          </Button>

          <Button
            variant="outline" size="icon"
            onClick={stepForward}
            disabled={!isSolved || currentStep === steps.length - 1}
            className="h-9 w-9 rounded-full bg-transparent border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"
          >
            <SkipForward className="h-4 w-4" />
          </Button>

          <div className="flex-1 px-4">
            <Slider
              disabled={!isSolved}
              value={isSolved ? [currentStep] : [0]}
              min={0}
              max={Math.max(steps.length - 1, 0)}
              step={1}
              onValueChange={(v) => setCurrentStep(Array.isArray(v) ? v[0] : v)}
              className="w-full"
            />
          </div>

          <span className="text-xs font-mono text-slate-500 w-20 text-right">
            {isSolved ? `Step ${currentStep + 1}/${steps.length}` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Extracted sub-component to avoid full-page re-renders on each keystroke ──
function ProblemInput({ isSolving, onSolve }: { isSolving: boolean; onSolve: (t: string) => void }) {
  const [text, setTextState] = [
    "" as string,
    (v: string) => {},
  ];
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [localText, setLocalText] = [
    "" as string,
    (v: string) => {},
  ];

  // Using simple React state locally — problem text is not Zustand state until submitted
  const { useState } = require("react");
  const [inputText, setInputText] = useState("");

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="e.g. A 2 kg ball is swung in a vertical circle of radius 1.5 m. Find the minimum speed at the top."
        className="resize-none h-24 text-sm focus-visible:ring-blue-500"
        value={inputText}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInputText(e.target.value)}
      />
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
        onClick={() => onSolve(inputText)}
        disabled={isSolving || inputText.trim().length === 0}
      >
        {isSolving ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin">⚙</span> Solving…
          </span>
        ) : "Solve & Simulate"}
      </Button>
    </div>
  );
}
