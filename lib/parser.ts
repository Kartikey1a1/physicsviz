/**
 * Layer 1: Deterministic Regex Parser
 *
 * Handles ~85% of standard AP Physics C textbook problems instantly, for free.
 * Returns { domain, knowns, unknowns, confidence }.
 * confidence: "high" → skip LLM.  confidence: "low" → trigger Layer 2 LLM fallback.
 *
 * Layer 2 (OpenRouter Llama fallback) is invoked only when confidence === "low".
 */
import synonyms from "./synonyms.json";

export type PhysicsTag =
  | "kinematics_1d"
  | "projectile"
  | "vertical_circle"
  | "shm"
  | "rotation"
  | "incline"
  | "energy_conservation"
  | "momentum"
  | "centripetal"
  | "gravitation"
  | "unknown";

export interface ParseResult {
  domains: PhysicsTag[];
  knowns: Record<string, number>;
  unknowns: string[];
  objectType: string;
  confidence: "high" | "low";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a numeric value following a label like "2 m/s²", "3kg", "45°" */
function extractNum(text: string, patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

/** Map a raw noun to its canonical shape via synonym dictionary */
function resolveObject(text: string): string {
  const lower = text.toLowerCase();
  const dict = synonyms as unknown as Record<string, string>;
  for (const [key, val] of Object.entries(dict)) {
    if (key.startsWith("_")) continue; // skip metadata keys
    if (lower.includes(key)) return val;
  }
  return "point_mass"; // safe fallback
}

/** Extract what the user explicitly requested */
export function extractExplicitUnknowns(text: string, fallback: string[]): string[] {
  const regex = /(?:find|what\s+is|calculate|determine|solve\s+for)(?:\s+the)?\s+([a-z\s]+)/ig;
  const unknowns = new Set<string>();

  const symbolMap: Record<string, string> = {
    "initial velocity": "v0",
    "initial speed": "v0",
    "final velocity": "v",
    "final speed": "v",
    "velocity": "v",
    "speed": "v",
    "time": "t",
    "distance": "d",
    "displacement": "d",
    "acceleration": "a",
    "work": "W",
    "energy": "E",
    "radius": "r",
    "period": "T",
    "minimum speed": "v_min",
    "angular frequency": "omega",
    "frequency": "f",
    "angular velocity": "omega",
    "angular speed": "omega",
    "angular acceleration": "alpha",
    "torque": "tau",
    "momentum": "p",
    "force": "F",
    "angle": "theta"
  };
  
  const sortedKeys = Object.keys(symbolMap).sort((a, b) => b.length - a.length);

  let match;
  while ((match = regex.exec(text)) !== null) {
    let targetPhrase = match[1].toLowerCase();
    for (const key of sortedKeys) {
      if (targetPhrase.includes(key)) {
        unknowns.add(symbolMap[key]);
        targetPhrase = targetPhrase.replace(key, "");
      }
    }
  }

  return unknowns.size > 0 ? Array.from(unknowns) : fallback;
}

// ─── Domain Patterns ──────────────────────────────────────────────────────────

function try1DKinematics(text: string): ParseResult | null {
  const hasAccel = /accel|a\s*=|m\/s[²2]/i.test(text);
  const hasTime = /\d+\s*s(econds?)?|\bfor\s+\d/i.test(text);
  const hasVelocity = /veloc|speed|v\s*=|m\/s/i.test(text);
  if (!(hasAccel || hasVelocity) || !hasTime) return null;

  const a = extractNum(text, [/(\d+\.?\d*)\s*m\/s[²2]/i, /accel.*?(\d+\.?\d*)/i]) ?? 0;
  const t = extractNum(text, [/(\d+\.?\d*)\s*s(?:ec)?/i, /for\s+(\d+\.?\d*)/i]) ?? 0;
  const v0 = extractNum(text, [/from\s+rest/i.test(text) ? /^$/ : /init.*?(\d+\.?\d*)/i, /v0\s*=\s*(\d+\.?\d*)/i]) ?? 0;

  const unknowns: string[] = [];
  if (/distance|displacement|how far|find d/i.test(text)) unknowns.push("d");
  if (/final.*veloc|speed.*after|v_f/i.test(text)) unknowns.push("v_f");
  if (unknowns.length === 0) unknowns.push("d");

  return {
    domains: ["kinematics_1d"],
    knowns: { a, t, v0 },
    unknowns,
    objectType: resolveObject(text),
    confidence: a > 0 || v0 > 0 ? "high" : "low",
  };
}

function tryVerticalCircle(text: string): ParseResult | null {
  if (!/vertical\s*circle|loop|swung|swings|minimum\s*speed/i.test(text)) return null;

  const r = extractNum(text, [/radius.*?(\d+\.?\d*)/i, /(\d+\.?\d*)\s*m\s*(?:radius|long)/i]);
  const m = extractNum(text, [/(\d+\.?\d*)\s*kg/i]);

  return {
    domains: ["centripetal"],
    knowns: { r: r ?? 1, m: m ?? 1, g: 9.81 },
    unknowns: ["v_min"],
    objectType: resolveObject(text),
    confidence: r !== null ? "high" : "low",
  };
}

function trySHMSpring(text: string): ParseResult | null {
  if (!/spring|oscillat|shm|simple harmonic/i.test(text)) return null;

  const k = extractNum(text, [/k\s*=\s*(\d+\.?\d*)/i, /(\d+\.?\d*)\s*N\/m/i]);
  const m = extractNum(text, [/(\d+\.?\d*)\s*kg/i]);
  const A = extractNum(text, [/amplitude.*?(\d+\.?\d*)/i, /(\d+\.?\d*)\s*m(?:eters?)?\s*(?:from|amplitude)/i]);

  return {
    domains: ["shm"],
    knowns: { k: k ?? 10, m: m ?? 1, A: A ?? 0.1, g: 9.81 },
    unknowns: ["omega", "T", "v_max"],
    objectType: "spring",
    confidence: k !== null && m !== null ? "high" : "low",
  };
}

function tryInclineEnergy(text: string): ParseResult | null {
  if (!/\b(?:ramp|incline|slope|slides? down|sliding down|frictionless surface|frictionless ramp|frictionless)\b/i.test(text)) return null;

  const h = extractNum(text, [/height.*?(\d+\.?\d*)/i, /h\s*=\s*(\d+\.?\d*)/i, /(\d+\.?\d*)\s*m\s*(?:high|above|tall)/i]);
  if (h === null) return null;

  const m = extractNum(text, [/(\d+\.?\d*)\s*kg/i]) ?? 1;

  return {
    domains: ["incline", "energy_conservation"],
    knowns: { m, h, g: 9.81 },
    unknowns: ["v_f", "W"],
    objectType: resolveObject(text),
    confidence: "high",
  };
}

function tryProjectile(text: string): ParseResult | null {
  if (!/projectile|launch|thrown|angle|degrees?/i.test(text)) return null;

  const v0 = extractNum(text, [/(\d+\.?\d*)\s*m\/s/i, /speed.*?(\d+\.?\d*)/i]);
  const angle = extractNum(text, [/(\d+\.?\d*)\s*deg/i, /at\s+(\d+\.?\d*)\s*°/i]);
  const h = extractNum(text, [/height.*?(\d+\.?\d*)/i, /(\d+\.?\d*)\s*m\s*(?:high|above)/i]) ?? 0;

  return {
    domains: ["projectile"],
    knowns: { v0: v0 ?? 10, angle: angle ?? 45, h0: h, g: 9.81 },
    unknowns: ["x_max", "t_flight", "v_impact"],
    objectType: resolveObject(text),
    confidence: v0 !== null ? "high" : "low",
  };
}

function tryRotation(text: string): ParseResult | null {
  if (!/rotat|torque|moment of inertia|angular|spin|disk|wheel/i.test(text)) return null;

  const tau = extractNum(text, [/torque.*?(\d+\.?\d*)/i, /(\d+\.?\d*)\s*N[·\*·]m/i]);
  const I = extractNum(text, [/moment.*?(\d+\.?\d*)/i, /I\s*=\s*(\d+\.?\d*)/i]);
  const omega0 = extractNum(text, [/initial.*?angular.*?(\d+\.?\d*)/i, /omega.*?0.*?(\d+\.?\d*)/i]) ?? 0;

  return {
    domains: ["rotation"],
    knowns: { tau: tau ?? 0, I: I ?? 1, omega0 },
    unknowns: ["alpha", "omega_f", "theta"],
    objectType: resolveObject(text),
    confidence: (tau !== null || I !== null) ? "high" : "low",
  };
}

function tryEnergy(text: string): ParseResult | null {
  if (!/energy|work|kinetic|potential|conserv/i.test(text)) return null;

  const m = extractNum(text, [/(\d+\.?\d*)\s*kg/i]);
  const h = extractNum(text, [/height.*?(\d+\.?\d*)/i, /(\d+\.?\d*)\s*m\s*(?:high|above|tall)/i]);
  const v0 = extractNum(text, [/(\d+\.?\d*)\s*m\/s/i]) ?? 0;

  return {
    domains: ["energy_conservation"],
    knowns: { m: m ?? 1, h: h ?? 1, v0, g: 9.81 },
    unknowns: ["v_f", "W"],
    objectType: resolveObject(text),
    confidence: m !== null && h !== null ? "high" : "low",
  };
}

function tryMomentum(text: string): ParseResult | null {
  if (!/collision|momentum|impulse|elastic|inelastic|collide/i.test(text)) return null;

  const m1 = extractNum(text, [/first.*?(\d+\.?\d*)\s*kg/i, /m1\s*=\s*(\d+\.?\d*)/i]);
  const m2 = extractNum(text, [/second.*?(\d+\.?\d*)\s*kg/i, /m2\s*=\s*(\d+\.?\d*)/i]);
  const v1 = extractNum(text, [/(\d+\.?\d*)\s*m\/s/i]);
  const isElastic = /elastic/i.test(text) && !/inelastic/i.test(text);

  return {
    domains: ["momentum"],
    knowns: { m1: m1 ?? 1, m2: m2 ?? 1, v1: v1 ?? 5, v2: 0 },
    unknowns: isElastic ? ["v1_f", "v2_f"] : ["v_f"],
    objectType: "point_mass",
    confidence: m1 !== null && v1 !== null ? "high" : "low",
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function parsePhysicsProblem(text: string): ParseResult {
  const attempts = [
    tryVerticalCircle,
    trySHMSpring,
    tryInclineEnergy,
    tryProjectile,
    tryRotation,
    tryMomentum,
    tryEnergy,
    try1DKinematics, // most general — run last
  ];

  for (const attempt of attempts) {
    const result = attempt(text);
    if (result) {
      result.unknowns = extractExplicitUnknowns(text, result.unknowns);
      return result;
    }
  }

  // Layer 1 gave up — signal Layer 2
  return {
    domains: ["unknown"],
    knowns: {},
    unknowns: [],
    objectType: resolveObject(text),
    confidence: "low",
  };
}
