"""
PhysicsViz SymPy Worker
=======================
A standalone FastAPI service deployed on Railway or Render (free tier).
Vercel forwards equation-solving requests to this service.

Endpoints:
- GET  /warmup  → simple 200 (pre-warming)
- POST /solve   → symbolic solve via SymPy
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Optional
import os
import sympy as sp
import json
import traceback

SYMBOLS = {
    "v":     sp.Symbol("v",     real=True, positive=True),
    "v0":    sp.Symbol("v0",    real=True, nonnegative=True),
    "h":     sp.Symbol("h",     real=True, positive=True),
    "g":     sp.Symbol("g",     real=True, positive=True),
    "m":     sp.Symbol("m",     real=True, positive=True),
    "r":     sp.Symbol("r",     real=True, positive=True),
    "k":     sp.Symbol("k",     real=True, positive=True),
    "A":     sp.Symbol("A",     real=True, positive=True),
    "omega": sp.Symbol("omega", real=True, positive=True),
    "theta": sp.Symbol("theta", real=True, positive=True),
    "I":     sp.Symbol("I",     real=True, positive=True),
    "alpha": sp.Symbol("alpha", real=True),
    "tau":   sp.Symbol("tau",   real=True),
    "T":     sp.Symbol("T",     real=True, positive=True),
    "t":     sp.Symbol("t",     real=True, nonnegative=True),
    # Additional symbols found in the code
    "v_f":   sp.Symbol("v_f",   real=True),
    "a":     sp.Symbol("a",     real=True),
    "d":     sp.Symbol("d",     real=True),
    "angle": sp.Symbol("angle", real=True),
    "t_flight": sp.Symbol("t_flight", real=True),
    "x_max": sp.Symbol("x_max", real=True),
    "h0":    sp.Symbol("h0",    real=True),
    "v_impact": sp.Symbol("v_impact", real=True),
    "F_net": sp.Symbol("F_net", real=True),
    "x":     sp.Symbol("x",     real=True),
    "phi":   sp.Symbol("phi",   real=True),
    "omega0":sp.Symbol("omega0", real=True),
    "omega_f":sp.Symbol("omega_f", real=True),
    "N":     sp.Symbol("N",     real=True),
    "p":     sp.Symbol("p",     real=True),
    "F":     sp.Symbol("F",     real=True),
    "J":     sp.Symbol("J",     real=True),
    "G":     sp.Symbol("G",     real=True),
    "m1":    sp.Symbol("m1",    real=True),
    "m2":    sp.Symbol("m2",    real=True),
}

ALIASES = {
    "v_top":    "v",
    "v_bottom": "v",
    "v_final":  "v",
    "v_f":      "v",
    "v_min":    "v_min",
    "v_max":    "v",
}

app = FastAPI(title="PhysicsViz SymPy Worker")

# CORS: restrict to your Vercel domain in production.
# Set ALLOWED_ORIGIN env var on Railway/Render, e.g.:
#   ALLOWED_ORIGIN=https://physicsviz.vercel.app
# Falls back to * for local development only.
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ─── Request / Response Models ────────────────────────────────────────────────

class SolveRequest(BaseModel):
    domains: list[str]
    knowns: dict[str, float]
    unknowns: list[str]
    object_type: str = "point_mass"


class SolveResponse(BaseModel):
    solved: dict[str, Any]
    solution_steps: list[dict[str, Any]]
    latex_results: dict[str, str]


# ─── Domain Solvers ───────────────────────────────────────────────────────────

def solve_kinematics_1d(knowns: dict, unknowns: list[str]) -> dict:
    v0 = SYMBOLS['v0']
    a = SYMBOLS['a']
    t = SYMBOLS['t']
    d = SYMBOLS['d']
    v_f = SYMBOLS['v_f']
    eqs = [
        sp.Eq(d, v0 * t + sp.Rational(1, 2) * a * t**2),
        sp.Eq(v_f, v0 + a * t),
    ]
    subs = {str(sym): val for sym, val in zip([v0, a, t, d, v_f], [
        knowns.get("v0", 0), knowns.get("a", 0), knowns.get("t", 0),
        knowns.get("d"), knowns.get("v_f")
    ]) if val is not None}

    sym_map = {"v0": v0, "a": a, "t": t, "d": d, "v_f": v_f}
    known_subs = {sym_map[k]: v for k, v in knowns.items() if k in sym_map}
    target_syms = [sym_map[u] for u in unknowns if u in sym_map]

    simplified_eqs = [eq.subs(known_subs) for eq in eqs]
    result = sp.solve(simplified_eqs, target_syms, dict=True)
    return {str(k): v for k, v in result[0].items()} if result else {}


def solve_vertical_circle(knowns: dict, unknowns: list[str]) -> dict:
    m = SYMBOLS['m']
    g = SYMBOLS['g']
    r = SYMBOLS['r']
    T = SYMBOLS['T']
    v = SYMBOLS['v']
    # At bottom: T - mg = mv²/r  →  v_min at top: T=0 → v² = gr
    v_min = sp.sqrt(knowns.get("g", 9.81) * knowns.get("r", 1))
    v_bottom = sp.sqrt(5 * knowns.get("g", 9.81) * knowns.get("r", 1))
    return {"v_min": float(v_min), "v_bottom": float(v_bottom)}


def solve_shm_spring(knowns: dict, unknowns: list[str]) -> dict:
    k_val = knowns.get("k", 10)
    m_val = knowns.get("m", 1)
    A_val = knowns.get("A", 0.1)
    k = SYMBOLS['k']
    m = SYMBOLS['m']
    A = SYMBOLS['A']
    omega = sp.sqrt(k / m)
    T = 2 * sp.pi / omega
    v_max = A * omega
    result = {
        "omega": float(omega.subs({k: k_val, m: m_val})),
        "T": float(T.subs({k: k_val, m: m_val})),
        "v_max": float(v_max.subs({k: k_val, m: m_val, A: A_val})),
    }
    return result


def solve_rotation(knowns: dict, unknowns: list[str]) -> dict:
    tau_val = knowns.get("tau", 0)
    I_val = knowns.get("I", 1)
    omega0_val = knowns.get("omega0", 0)
    t_val = knowns.get("t", 1)
    tau = SYMBOLS['tau']
    I = SYMBOLS['I']
    alpha = SYMBOLS['alpha']
    omega0 = SYMBOLS['omega0']
    omega_f = SYMBOLS['omega_f']
    t = SYMBOLS['t']
    theta = SYMBOLS['theta']
    eqs = [
        sp.Eq(tau, I * alpha),
        sp.Eq(omega_f, omega0 + alpha * t),
        sp.Eq(theta, omega0 * t + sp.Rational(1, 2) * alpha * t**2),
    ]
    subs = {tau: tau_val, I: I_val, omega0: omega0_val, t: t_val}
    simplified = [eq.subs(subs) for eq in eqs]
    solved = sp.solve(simplified, [alpha, omega_f, theta], dict=True)
    return {str(k): float(v) for k, v in solved[0].items()} if solved else {}


def solve_energy(knowns: dict, unknowns: list[str]) -> dict:
    m_val = knowns.get("m", 1)
    h_val = knowns.get("h", 1)
    v0_val = knowns.get("v0", 0)
    g_val = knowns.get("g", 9.81)
    # KE_f = KE_i + PE_i  (conservation, no friction)
    v_f = float(sp.sqrt(v0_val**2 + 2 * g_val * h_val))
    W = float(m_val * g_val * h_val)
    return {"v_f": v_f, "W": W}


def solve_incline_energy(knowns: dict, unknowns: list[str]) -> dict:
    m_val = knowns.get("m", 1)
    h_val = knowns.get("h", 1)
    g_val = knowns.get("g", 9.81)
    v_f = float(sp.sqrt(2 * g_val * h_val))
    W = float(m_val * g_val * h_val)
    return {"v_f": v_f, "W": W}


def solve_momentum(knowns: dict, unknowns: list[str]) -> dict:
    m1, m2, v1_val = knowns.get("m1", 1), knowns.get("m2", 1), knowns.get("v1", 5)
    v2_val = knowns.get("v2", 0)
    # Perfectly inelastic by default
    v_f = (m1 * v1_val + m2 * v2_val) / (m1 + m2)
    return {"v_f": float(v_f)}


def solve_projectile(knowns: dict, unknowns: list[str]) -> dict:
    import math
    v0 = knowns.get("v0", 10)
    angle_deg = knowns.get("angle", 45)
    g = knowns.get("g", 9.81)
    h0 = knowns.get("h0", 0)
    rad = math.radians(angle_deg)
    v0x = v0 * math.cos(rad)
    v0y = v0 * math.sin(rad)
    # time of flight (quadratic)
    discriminant = v0y**2 + 2 * g * h0
    t_flight = (v0y + math.sqrt(discriminant)) / g
    x_max = v0x * t_flight
    return {"t_flight": round(t_flight, 4), "x_max": round(x_max, 4), "v0x": round(v0x, 4), "v0y": round(v0y, 4)}


def build_kinematics_1d_equations(knowns: dict) -> list[sp.Eq]:
    v0 = SYMBOLS['v0']
    a = SYMBOLS['a']
    t = SYMBOLS['t']
    d = SYMBOLS['d']
    v_f = SYMBOLS['v_f']
    return [
        sp.Eq(d, v0 * t + sp.Rational(1, 2) * a * t**2),
        sp.Eq(v_f, v0 + a * t),
    ]


def build_projectile_equations(knowns: dict) -> list[sp.Eq]:
    v0 = SYMBOLS['v0']
    angle = SYMBOLS['angle']
    t_flight = SYMBOLS['t_flight']
    x_max = SYMBOLS['x_max']
    h0 = SYMBOLS['h0']
    g = SYMBOLS['g']
    v_impact = SYMBOLS['v_impact']
    projectile_velocity = sp.sqrt(
        (v0 * sp.cos(angle * sp.pi / 180)) ** 2
        + (v0 * sp.sin(angle * sp.pi / 180) - g * t_flight) ** 2
    )
    return [
        sp.Eq(x_max, v0 * sp.cos(angle * sp.pi / 180) * t_flight),
        sp.Eq(0, h0 + v0 * sp.sin(angle * sp.pi / 180) * t_flight - sp.Rational(1, 2) * g * t_flight**2),
        sp.Eq(v_impact, projectile_velocity),
    ]


def build_centripetal_equations(knowns: dict) -> list[sp.Eq]:
    m = SYMBOLS['m']
    v = SYMBOLS['v']
    r = SYMBOLS['r']
    F_net = SYMBOLS['F_net']
    return [sp.Eq(m * v**2 / r, F_net)]


def build_shm_equations(knowns: dict) -> list[sp.Eq]:
    x = SYMBOLS['x']
    A = SYMBOLS['A']
    omega = SYMBOLS['omega']
    t = SYMBOLS['t']
    phi = SYMBOLS['phi']
    return [sp.Eq(x, A * sp.cos(omega * t + phi))]


def build_rotation_equations(knowns: dict) -> list[sp.Eq]:
    tau = SYMBOLS['tau']
    I = SYMBOLS['I']
    alpha = SYMBOLS['alpha']
    omega0 = SYMBOLS['omega0']
    omega_f = SYMBOLS['omega_f']
    t = SYMBOLS['t']
    theta = SYMBOLS['theta']
    return [
        sp.Eq(tau, I * alpha),
        sp.Eq(omega_f, omega0 + alpha * t),
        sp.Eq(theta, omega0 * t + sp.Rational(1, 2) * alpha * t**2),
    ]


def build_incline_equations(knowns: dict) -> list[sp.Eq]:
    m = SYMBOLS['m']
    g = SYMBOLS['g']
    h = SYMBOLS['h']
    v = SYMBOLS['v']
    eqs = [sp.Eq(m * g * h, sp.Rational(1, 2) * m * v**2)]
    angle = knowns.get("angle")
    if angle is not None:
        N = SYMBOLS['N']
        eqs.append(sp.Eq(N, m * g * sp.cos(angle * sp.pi / 180)))
    return eqs


def build_energy_conservation_equations(knowns: dict) -> list[sp.Eq]:
    m = SYMBOLS['m']
    v0 = SYMBOLS['v0']
    v = SYMBOLS['v']
    g = SYMBOLS['g']
    h = SYMBOLS['h']
    return [sp.Eq(sp.Rational(1, 2) * m * v0**2 + m * g * h, sp.Rational(1, 2) * m * v**2)]


def build_momentum_equations(knowns: dict) -> list[sp.Eq]:
    m = SYMBOLS['m']
    v = SYMBOLS['v']
    p = SYMBOLS['p']
    F = SYMBOLS['F']
    t = SYMBOLS['t']
    J = SYMBOLS['J']
    return [
        sp.Eq(p, m * v),
        sp.Eq(J, F * t),
    ]


def build_gravitation_equations(knowns: dict) -> list[sp.Eq]:
    G = SYMBOLS['G']
    m1 = SYMBOLS['m1']
    m2 = SYMBOLS['m2']
    r = SYMBOLS['r']
    F = SYMBOLS['F']
    return [sp.Eq(F, G * m1 * m2 / r**2)]


EQUATION_BUILDERS = {
    "kinematics_1d": build_kinematics_1d_equations,
    "projectile": build_projectile_equations,
    "vertical_circle": build_centripetal_equations,
    "centripetal": build_centripetal_equations,
    "shm": build_shm_equations,
    "rotation": build_rotation_equations,
    "incline": build_incline_equations,
    "energy_conservation": build_energy_conservation_equations,
    "momentum": build_momentum_equations,
    "gravitation": build_gravitation_equations,
}


def collect_equations(domains: list[str], knowns: dict) -> list[sp.Eq]:
    equations: list[sp.Eq] = []
    for domain in domains:
        builder = EQUATION_BUILDERS.get(domain)
        if not builder:
            raise HTTPException(status_code=422, detail=f"No equation builder for domain tag: {domain}")
        equations.extend(builder(knowns))
    return equations


def _symbol_for(name: str):
    return SYMBOLS.get(name)


def solve_equations(domains: list[str], knowns: dict, unknowns: list[str]) -> dict:
    equations = collect_equations(domains, knowns)
    known_subs = {}
    for name, value in knowns.items():
        sym = _symbol_for(name)
        if sym is not None:
            known_subs[sym] = value

    substituted = [eq.subs(known_subs) for eq in equations]
    all_symbols = set().union(*(eq.free_symbols for eq in substituted))
    # Solve for all unresolved symbols to avoid overdetermined system failures
    unknown_symbols = [sym for sym in all_symbols if sym not in known_subs]
    if not unknown_symbols:
        raise HTTPException(status_code=422, detail="No unknown variables found in equations.")

    solved_list = sp.solve(substituted, unknown_symbols, dict=True)
    if not solved_list:
        raise HTTPException(status_code=422, detail="Could not solve the requested equations.")

    if isinstance(solved_list, list) and len(solved_list) > 0:
        solution = solved_list[0]
    else:
        solution = solved_list
        
    solved = {}
    import logging
    for sym, val in solution.items():
        try:
            solved[str(sym)] = float(val)
        except Exception:
            try:
                solved[str(sym)] = float(val.evalf())
            except Exception:
                logging.warning(f"Symbolic result for {sym} = {val}. Skipping to prevent crash.")
    return solved


def build_steps_for_domains(domains: list[str], knowns: dict, solved: dict, unknowns: list[str], object_type: str) -> list[dict]:
    steps: list[dict] = []
    for domain in domains:
        if domain == "energy_conservation" and "incline" in domains:
            continue
        if domain == "centripetal":
            steps.extend(build_steps_for_domain("vertical_circle", knowns, solved, unknowns, object_type))
        else:
            steps.extend(build_steps_for_domain(domain, knowns, solved, unknowns, object_type))

    raw_steps = steps or [{
        "step_id": 1, "concept": "Problem Parsed",
        "explanation": "Domain recognized but detailed steps not yet implemented.",
        "math_latex": "\\text{See knowns and solved values}",
        "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
        "provides": None, "depends_on": []
    }]

    target_vars = set(unknowns)
    for unk in unknowns:
        alias = ALIASES.get(unk)
        if alias:
            target_vars.add(alias)

    kept_steps = []
    
    for step in reversed(raw_steps):
        provides = step.get("provides")
        if provides in target_vars or provides is None:
            kept_steps.insert(0, step)
            for d in step.get("depends_on", []):
                target_vars.add(d)

    final_steps = []
    for i, step in enumerate(kept_steps):
        if step.get("provides") is None:
            if i + 1 < len(kept_steps) and kept_steps[i+1].get("provides") is not None:
                final_steps.append(step)
            elif len(kept_steps) == 1:
                final_steps.append(step)
        else:
            final_steps.append(step)

    for i, step in enumerate(final_steps):
        step["step_id"] = i + 1

    return final_steps

# Scale factor: 1 physical meter = DISPLAY_SCALE canvas pixels.
# Used consistently across ALL domain builders — never hardcode a pixel value.
DISPLAY_SCALE = 100  # type: int


# ─── Step & SimState Builders ─────────────────────────────────────────────────

def build_steps_for_domain(domain: str, knowns: dict, solved: dict, unknowns: list[str], object_type: str) -> list[dict]:
    """Returns solution_steps array. Every step MUST have a simulation_state (parallel array contract)."""
    g = knowns.get("g", 9.81)

    if domain == "kinematics_1d":
        a = knowns.get("a", 0)
        v0 = knowns.get("v0", 0)
        t = knowns.get("t", 0)
        d = float(solved.get("d", v0 * t + 0.5 * a * t**2))
        solved["d"] = d
        v_f = float(solved.get("v_f", v0 + a * t))
        solved["v_f"] = v_f
        return [
            {
                "step_id": 1, "concept": "Identify Knowns", "provides": None, "depends_on": [],
                "explanation": f"From the problem: initial velocity v₀ = {v0} m/s, acceleration a = {a} m/s², time t = {t} s.",
                "math_latex": f"v_0 = {v0}\\,\\text{{m/s}},\\quad a = {a}\\,\\text{{m/s}}^2,\\quad t = {t}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "a", "direction": [1, 0], "magnitude": a, "color": "#f97316"},
                ]},
            },
            {
                "step_id": 2, "concept": "Apply Kinematic Equation", "provides": "d", "depends_on": ["v0", "a", "t"],
                "explanation": f"Using d = v₀t + ½at², the displacement is {d:.2f} m.",
                "math_latex": f"d = v_0 t + \\frac{{1}}{{2}} a t^2 = {d:.2f}\\,\\text{{m}}",
                "simulation_state": {"time_range": [0, t], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": v0 * DISPLAY_SCALE, "c2": 0.5 * a * DISPLAY_SCALE}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Final Velocity", "provides": "v_f", "depends_on": ["v0", "a", "t"],
                "explanation": f"Final velocity v_f = v₀ + at = {v_f:.2f} m/s.",
                "math_latex": f"v_f = v_0 + at = {v_f:.2f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [t, t], "animations": [], "vectors": [
                    {"label": "v_f", "direction": [1, 0], "magnitude": v_f, "color": "#22c55e"},
                ]},
            },
        ]

    elif domain == "vertical_circle":
        r = knowns.get("r", 1)
        v_min = float(solved.get("v_min", (g * r) ** 0.5))
        solved["v_min"] = v_min
        T_period = float(2 * 3.14159 * r / v_min) if v_min > 0 else 1
        solved["T"] = T_period
        solved["omega"] = float(v_min / r) if r > 0 else 0
        return [
            {
                "step_id": 1, "concept": "Free Body Diagram at Top", "provides": None, "depends_on": [],
                "explanation": "At the top of the loop, gravity and tension both point toward the center.",
                "math_latex": "T + mg = \\frac{mv^2}{r}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "mg", "direction": [0, -1], "magnitude": g, "color": "#ef4444"},
                    {"label": "N", "direction": [0, -1], "magnitude": 0, "color": "#3b82f6"},
                ]},
            },
            {
                "step_id": 2, "concept": "Minimum Speed Condition", "provides": "v_min", "depends_on": ["g", "r"],
                "explanation": f"At minimum speed, tension T = 0, giving v_min = √(gr) = {v_min:.2f} m/s.",
                "math_latex": f"v_{{\\min}} = \\sqrt{{gr}} = \\sqrt{{{g} \\times {r}}} = {v_min:.2f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Full Circular Motion", "provides": "omega", "depends_on": ["v_min", "r"],
                "explanation": f"The object completes the full loop with ω = v/r.",
                "math_latex": f"\\omega = \\frac{{v_{{\\min}}}}{{r}} = {v_min/r:.2f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, T_period], "animations": [
                    {"target": "object", "type": "circular", "params": {"r": r * DISPLAY_SCALE, "omega": v_min / r, "x_center": 0, "y_center": 0}}
                ], "vectors": []},
            },
        ]

    elif domain == "shm":
        k = knowns.get("k", 10)
        m = knowns.get("m", 1)
        A = knowns.get("A", 0.1)
        omega = float(solved.get("omega", (k / m) ** 0.5))
        solved["omega"] = omega
        T_period = float(solved.get("T", 2 * 3.14159 / omega))
        solved["T"] = T_period
        v_max = float(solved.get("v_max", A * omega))
        solved["v_max"] = v_max
        return [
            {
                "step_id": 1, "concept": "Angular Frequency", "provides": "omega", "depends_on": ["k", "m"],
                "explanation": f"ω = √(k/m) = √({k}/{m}) = {omega:.3f} rad/s",
                "math_latex": f"\\omega = \\sqrt{{\\frac{{k}}{{m}}}} = {omega:.3f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Period of Oscillation", "provides": "T", "depends_on": ["omega"],
                "explanation": f"T = 2π/ω = {T_period:.3f} s",
                "math_latex": f"T = \\frac{{2\\pi}}{{\\omega}} = {T_period:.3f}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, T_period], "animations": [
                    {"target": "object", "type": "harmonic", "params": {"A": A * DISPLAY_SCALE, "omega": omega, "phi": 0}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Maximum Speed", "provides": "v_max", "depends_on": ["A", "omega"],
                "explanation": f"v_max = Aω = {A}×{omega:.2f} = {v_max:.3f} m/s",
                "math_latex": f"v_{{\\max}} = A\\omega = {v_max:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, T_period], "animations": [
                    {"target": "object", "type": "harmonic", "params": {"A": A * DISPLAY_SCALE, "omega": omega, "phi": 0}}
                ], "vectors": [
                    {"label": "v_max", "direction": [1, 0], "magnitude": v_max, "color": "#22c55e"},
                ]},
            },
        ]

    elif domain == "rotation":
        alpha = float(solved.get("alpha", 0))
        solved["alpha"] = alpha
        omega_f = float(solved.get("omega_f", 0))
        solved["omega_f"] = omega_f
        theta = float(solved.get("theta", 0))
        solved["theta"] = theta
        t = knowns.get("t", 1)
        return [
            {
                "step_id": 1, "concept": "Angular Acceleration", "provides": "alpha", "depends_on": ["tau", "I"],
                "explanation": f"By Newton's 2nd law for rotation: τ = Iα → α = {alpha:.3f} rad/s²",
                "math_latex": f"\\alpha = \\frac{{\\tau}}{{I}} = {alpha:.3f}\\,\\text{{rad/s}}^2",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Angular Velocity", "provides": "omega_f", "depends_on": ["omega0", "alpha", "t"],
                "explanation": f"ω_f = ω₀ + αt = {omega_f:.3f} rad/s",
                "math_latex": f"\\omega_f = \\omega_0 + \\alpha t = {omega_f:.3f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, t], "animations": [
                    {"target": "object", "type": "rotate", "params": {"c0": 0, "c1": knowns.get("omega0", 0), "c2": 0.5 * alpha}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Angle Rotated", "provides": "theta", "depends_on": ["omega0", "t", "alpha"],
                "explanation": f"θ = ω₀t + ½αt² = {theta:.3f} rad",
                "math_latex": f"\\theta = {theta:.3f}\\,\\text{{rad}} = {theta * 180 / 3.14159:.1f}°",
                "simulation_state": {"time_range": [t, t], "animations": [], "vectors": []},
            },
        ]

    elif domain == "energy_conservation":
        v = float(solved.get("v", solved.get("v_f", 0)))
        solved["v"] = v
        W = float(solved.get("W", 0))
        solved["W"] = W
        h = knowns.get("h", 1)
        t_approx = float((2 * h / g) ** 0.5) if g > 0 else 1
        return [
            {
                "step_id": 1, "concept": "Conservation of Energy", "provides": None, "depends_on": [],
                "explanation": "Total mechanical energy is conserved: KE_i + PE_i = KE_f + PE_f",
                "math_latex": "\\frac{1}{2}mv_0^2 + mgh = \\frac{1}{2}mv^2",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "mg", "direction": [0, -1], "magnitude": g, "color": "#ef4444"},
                ]},
            },
            {
                "step_id": 2, "concept": "Final Velocity", "provides": "v", "depends_on": ["v0", "g", "h"],
                "explanation": f"v = √(v₀² + 2gh) = {v:.3f} m/s",
                "math_latex": f"v = \\sqrt{{v_0^2 + 2gh}} = {v:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, t_approx], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": knowns.get("v0", 0) * DISPLAY_SCALE, "c2": 0.5 * g * DISPLAY_SCALE}}
                ], "vectors": []},
            },
        ]

    elif domain == "incline":
        m_val = knowns.get("m", 1)
        v = float(solved.get("v", solved.get("v_f", 0)))
        solved["v"] = v
        W = float(solved.get("W", 0))
        solved["W"] = W
        h = knowns.get("h", 1)
        return [
            {
                "step_id": 1, "concept": "Conservation of Mechanical Energy", "provides": None, "depends_on": [],
                "explanation": "On a frictionless incline, potential energy is converted entirely into kinetic energy.",
                "math_latex": "mgh = \\frac{1}{2}mv^2",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "mg", "direction": [0, -1], "magnitude": g, "color": "#ef4444"},
                ]},
            },
            {
                "step_id": 2, "concept": "Solve for Final Speed", "provides": "v", "depends_on": ["g", "h"],
                "explanation": f"Solve mgh = ½mv² for v, giving v = √(2gh) = {v:.3f} m/s.",
                "math_latex": f"v = \\sqrt{{2gh}} = {v:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 1], "animations": [
                    {"target": "object", "type": "linear", "params": {"start": [0, 0], "end": [h * DISPLAY_SCALE, 0], "duration": 1}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Work Done by Gravity", "provides": "W", "depends_on": ["m", "g", "h"],
                "explanation": f"The work done by gravity equals the loss in potential energy: W = mgh = {W:.2f} J.",
                "math_latex": f"W = mgh = {m_val} \\cdot {g} \\cdot {h} = {W:.2f}\\,\\text{{J}}",
                "simulation_state": {"time_range": [1, 1], "animations": [], "vectors": []},
            },
        ]

    elif domain == "momentum":
        v_f = float(solved.get("v_f", 0))
        solved["v_f"] = v_f
        m1 = knowns.get("m1", 1)
        m2 = knowns.get("m2", 1)
        v1 = knowns.get("v1", 5)
        return [
            {
                "step_id": 1, "concept": "Conservation of Momentum", "provides": None, "depends_on": [],
                "explanation": "Total momentum is conserved in all collisions.",
                "math_latex": "m_1 v_1 + m_2 v_2 = (m_1 + m_2)v_f",
                "simulation_state": {"time_range": [0, 0], "animations": [
                    {"target": "object1", "type": "polynomial", "params": {"c0": -DISPLAY_SCALE * 2, "c1": v1 * DISPLAY_SCALE, "c2": 0}},
                ], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Final Velocity After Collision", "provides": "v_f", "depends_on": ["m1", "v1", "m2", "v2"],
                "explanation": f"v_f = (m₁v₁ + m₂v₂)/(m₁+m₂) = {v_f:.3f} m/s",
                "math_latex": f"v_f = \\frac{{m_1 v_1 + m_2 v_2}}{{m_1 + m_2}} = {v_f:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 2], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": v_f * DISPLAY_SCALE, "c2": 0}},
                ], "vectors": []},
            },
        ]

    elif domain == "projectile":
        import math
        v0 = knowns.get("v0", 0)
        angle_deg = knowns.get("angle", 0)
        v0x = float(solved.get("v0x", v0 * math.cos(math.radians(angle_deg))))
        solved["v0x"] = v0x
        v0y = float(solved.get("v0y", v0 * math.sin(math.radians(angle_deg))))
        solved["v0y"] = v0y
        t_flight = float(solved.get("t_flight", 1))
        solved["t_flight"] = t_flight
        x_max = float(solved.get("x_max", 10))
        solved["x_max"] = x_max
        return [
            {
                "step_id": 1, "concept": "Decompose Initial Velocity", "provides": "v0y", "depends_on": ["v0", "angle"],
                "explanation": f"Split v₀ into components: v₀ₓ = {v0x:.2f} m/s, v₀ᵧ = {v0y:.2f} m/s",
                "math_latex": f"v_{{0x}} = v_0\\cos\\theta = {v0x:.2f}\\,\\text{{m/s}}, \\quad v_{{0y}} = v_0\\sin\\theta = {v0y:.2f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "v₀ₓ", "direction": [1, 0], "magnitude": v0x, "color": "#3b82f6"},
                    {"label": "v₀ᵧ", "direction": [0, 1], "magnitude": v0y, "color": "#22c55e"},
                ]},
            },
            {
                "step_id": 2, "concept": "Time of Flight", "provides": "t_flight", "depends_on": ["v0y", "g", "h0"],
                "explanation": f"Solving for when y = 0: t_flight = {t_flight:.3f} s",
                "math_latex": f"t_{{\\text{{flight}}}} = {t_flight:.3f}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, t_flight], "animations": [
                    {"target": "object", "type": "projectile", "params": {
                        "v0x": v0x, "v0y": v0y, "g": knowns.get("g", 9.81)
                    }}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Range", "provides": "x_max", "depends_on": ["v0x", "t_flight"],
                "explanation": f"Horizontal range x = v₀ₓ · t = {x_max:.3f} m",
                "math_latex": f"x = v_{{0x}} \\cdot t_{{\\text{{flight}}}} = {x_max:.3f}\\,\\text{{m}}",
                "simulation_state": {"time_range": [t_flight, t_flight], "animations": [], "vectors": []},
            },
        ]

    # Fallback
    return [{
        "step_id": 1, "concept": "Problem Parsed",
        "explanation": "Domain recognized but detailed steps not yet implemented.",
        "math_latex": "\\text{See knowns and solved values}",
        "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
    }]


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/warmup")
async def warmup():
    """Lightweight warmup endpoint — pre-warms the worker on Render/Railway."""
    return {"status": "warm"}


@app.post("/solve")
async def solve(req: SolveRequest):
    try:
        if not req.domains:
            raise HTTPException(status_code=422, detail="No domains provided for solve request.")

        solved = solve_equations(req.domains, req.knowns, req.unknowns)
        steps = build_steps_for_domains(req.domains, req.knowns, solved, req.unknowns, req.object_type)

        # Latex results for display
        latex = {k: f"{v:.4g}" for k, v in solved.items() if isinstance(v, (int, float))}

        return SolveResponse(solved=solved, solution_steps=steps, latex_results=latex)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
