/**
 * Zustand Scene Document Store
 *
 * This is the single source of truth for the entire application.
 * Data flows: Vercel API response → setSceneDocument() → UI components.
 *
 * Both the StepPanel and SimulationCanvas read from `sceneDocument.solution_steps[currentStep]`
 * using the SAME index, enforcing the Parallel Array Contract.
 */
import { create } from "zustand";

export interface SimulationState {
  time_range: [number, number];
  animations?: Array<{
    target: string;
    type: "polynomial" | "harmonic" | "rotate" | "circular";
    params: Record<string, number>;
  }>;
  vectors?: Array<{
    label: string;
    direction: [number, number];
    magnitude: number | string;
    color: string;
  }>;
}

export interface SolutionStep {
  step_id: number;
  concept: string;
  explanation: string;
  math_latex: string;
  simulation_state: SimulationState;
}

export interface SceneDocument {
  problem: string;
  solution_steps: SolutionStep[];
}

interface PhysicsVizStore {
  // Scene data
  sceneDocument: SceneDocument | null;
  setSceneDocument: (doc: SceneDocument) => void;
  clearScene: () => void;

  // Step navigation
  currentStep: number;
  setCurrentStep: (idx: number) => void;
  stepForward: () => void;
  stepBack: () => void;

  // UI state
  isSolving: boolean;
  setIsSolving: (v: boolean) => void;
  error: string | null;
  setError: (msg: string | null) => void;
}

export const usePhysicsStore = create<PhysicsVizStore>((set, get) => ({
  sceneDocument: null,
  setSceneDocument: (doc) => set({ sceneDocument: doc, currentStep: 0, error: null }),
  clearScene: () => set({ sceneDocument: null, currentStep: 0, error: null }),

  currentStep: 0,
  setCurrentStep: (idx) => set({ currentStep: idx }),
  stepForward: () => {
    const { currentStep, sceneDocument } = get();
    const max = (sceneDocument?.solution_steps.length ?? 1) - 1;
    set({ currentStep: Math.min(currentStep + 1, max) });
  },
  stepBack: () => {
    const { currentStep } = get();
    set({ currentStep: Math.max(currentStep - 1, 0) });
  },

  isSolving: false,
  setIsSolving: (v) => set({ isSolving: v }),
  error: null,
  setError: (msg) => set({ error: msg }),
}));
