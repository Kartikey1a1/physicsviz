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
    domain: str
    knowns: dict[str, float]
    unknowns: list[str]
    object_type: str = "point_mass"


class SolveResponse(BaseModel):
    solved: dict[str, Any]
    solution_steps: list[dict[str, Any]]
    latex_results: dict[str, str]


# ─── Domain Solvers ───────────────────────────────────────────────────────────

def solve_kinematics_1d(knowns: dict, unknowns: list[str]) -> dict:
    v0, a, t, d, v_f = sp.symbols("v0 a t d v_f")
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
    m, g, r, T, v = sp.symbols("m g r T v", positive=True)
    # At bottom: T - mg = mv²/r  →  v_min at top: T=0 → v² = gr
    v_min = sp.sqrt(knowns.get("g", 9.81) * knowns.get("r", 1))
    v_bottom = sp.sqrt(5 * knowns.get("g", 9.81) * knowns.get("r", 1))
    return {"v_min": float(v_min), "v_bottom": float(v_bottom)}


def solve_shm_spring(knowns: dict, unknowns: list[str]) -> dict:
    k_val = knowns.get("k", 10)
    m_val = knowns.get("m", 1)
    A_val = knowns.get("A", 0.1)
    k, m, A = sp.symbols("k m A", positive=True)
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
    tau, I, alpha, omega0, omega_f, t, theta = sp.symbols("tau I alpha omega0 omega_f t theta")
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


DOMAIN_SOLVERS = {
    "kinematics_1d": solve_kinematics_1d,
    "vertical_circle": solve_vertical_circle,
    "shm_spring": solve_shm_spring,
    "rotation": solve_rotation,
    "energy": solve_energy,
    "momentum": solve_momentum,
    "kinematics_2d_projectile": solve_projectile,
}

# Scale factor: 1 physical meter = DISPLAY_SCALE canvas pixels.
# Used consistently across ALL domain builders — never hardcode a pixel value.
DISPLAY_SCALE = 100  # type: int


# ─── Step & SimState Builders ─────────────────────────────────────────────────

def build_steps_for_domain(domain: str, knowns: dict, solved: dict, object_type: str) -> list[dict]:
    """Returns solution_steps array. Every step MUST have a simulation_state (parallel array contract)."""
    g = knowns.get("g", 9.81)

    if domain == "kinematics_1d":
        a = knowns.get("a", 0)
        v0 = knowns.get("v0", 0)
        t = knowns.get("t", 0)
        d = float(solved.get("d", v0 * t + 0.5 * a * t**2))
        v_f = float(solved.get("v_f", v0 + a * t))
        return [
            {
                "step_id": 1, "concept": "Identify Knowns",
                "explanation": f"From the problem: initial velocity v₀ = {v0} m/s, acceleration a = {a} m/s², time t = {t} s.",
                "math_latex": f"v_0 = {v0}\\,\\text{{m/s}},\\quad a = {a}\\,\\text{{m/s}}^2,\\quad t = {t}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "a", "direction": [1, 0], "magnitude": a, "color": "#f97316"},
                ]},
            },
            {
                "step_id": 2, "concept": "Apply Kinematic Equation",
                "explanation": f"Using d = v₀t + ½at², the displacement is {d:.2f} m.",
                "math_latex": f"d = v_0 t + \\frac{{1}}{{2}} a t^2 = {d:.2f}\\,\\text{{m}}",
                "simulation_state": {"time_range": [0, t], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": v0 * DISPLAY_SCALE, "c2": 0.5 * a * DISPLAY_SCALE}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Final Velocity",
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
        T_period = float(2 * 3.14159 * r / v_min) if v_min > 0 else 1
        return [
            {
                "step_id": 1, "concept": "Free Body Diagram at Top",
                "explanation": "At the top of the loop, gravity and tension both point toward the center.",
                "math_latex": "T + mg = \\frac{mv^2}{r}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "mg", "direction": [0, -1], "magnitude": g, "color": "#ef4444"},
                    {"label": "N", "direction": [0, -1], "magnitude": 0, "color": "#3b82f6"},
                ]},
            },
            {
                "step_id": 2, "concept": "Minimum Speed Condition",
                "explanation": f"At minimum speed, tension T = 0, giving v_min = √(gr) = {v_min:.2f} m/s.",
                "math_latex": f"v_{{\\min}} = \\sqrt{{gr}} = \\sqrt{{{g} \\times {r}}} = {v_min:.2f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Full Circular Motion",
                "explanation": f"The object completes the full loop with ω = v/r.",
                "math_latex": f"\\omega = \\frac{{v_{{\\min}}}}{{r}} = {v_min/r:.2f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, T_period], "animations": [
                    {"target": "object", "type": "circular", "params": {"r": r * DISPLAY_SCALE, "omega": v_min / r, "x_center": 0, "y_center": 0}}
                ], "vectors": []},
            },
        ]

    elif domain == "shm_spring":
        k = knowns.get("k", 10)
        m = knowns.get("m", 1)
        A = knowns.get("A", 0.1)
        omega = float(solved.get("omega", (k / m) ** 0.5))
        T_period = float(solved.get("T", 2 * 3.14159 / omega))
        v_max = float(solved.get("v_max", A * omega))
        return [
            {
                "step_id": 1, "concept": "Angular Frequency",
                "explanation": f"ω = √(k/m) = √({k}/{m}) = {omega:.3f} rad/s",
                "math_latex": f"\\omega = \\sqrt{{\\frac{{k}}{{m}}}} = {omega:.3f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Period of Oscillation",
                "explanation": f"T = 2π/ω = {T_period:.3f} s",
                "math_latex": f"T = \\frac{{2\\pi}}{{\\omega}} = {T_period:.3f}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, T_period], "animations": [
                    {"target": "object", "type": "harmonic", "params": {"A": A * DISPLAY_SCALE, "omega": omega, "phi": 0}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Maximum Speed",
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
        omega_f = float(solved.get("omega_f", 0))
        theta = float(solved.get("theta", 0))
        t = knowns.get("t", 1)
        return [
            {
                "step_id": 1, "concept": "Angular Acceleration",
                "explanation": f"By Newton's 2nd law for rotation: τ = Iα → α = {alpha:.3f} rad/s²",
                "math_latex": f"\\alpha = \\frac{{\\tau}}{{I}} = {alpha:.3f}\\,\\text{{rad/s}}^2",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Angular Velocity",
                "explanation": f"ω_f = ω₀ + αt = {omega_f:.3f} rad/s",
                "math_latex": f"\\omega_f = \\omega_0 + \\alpha t = {omega_f:.3f}\\,\\text{{rad/s}}",
                "simulation_state": {"time_range": [0, t], "animations": [
                    {"target": "object", "type": "rotate", "params": {"c0": 0, "c1": knowns.get("omega0", 0), "c2": 0.5 * alpha}}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Angle Rotated",
                "explanation": f"θ = ω₀t + ½αt² = {theta:.3f} rad",
                "math_latex": f"\\theta = {theta:.3f}\\,\\text{{rad}} = {theta * 180 / 3.14159:.1f}°",
                "simulation_state": {"time_range": [t, t], "animations": [], "vectors": []},
            },
        ]

    elif domain == "energy":
        v_f = float(solved.get("v_f", 0))
        W = float(solved.get("W", 0))
        h = knowns.get("h", 1)
        t_approx = float((2 * h / g) ** 0.5) if g > 0 else 1
        return [
            {
                "step_id": 1, "concept": "Conservation of Energy",
                "explanation": "Total mechanical energy is conserved: KE_i + PE_i = KE_f + PE_f",
                "math_latex": "\\frac{1}{2}mv_0^2 + mgh = \\frac{1}{2}mv_f^2",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "mg", "direction": [0, -1], "magnitude": g, "color": "#ef4444"},
                ]},
            },
            {
                "step_id": 2, "concept": "Final Velocity",
                "explanation": f"v_f = √(v₀² + 2gh) = {v_f:.3f} m/s",
                "math_latex": f"v_f = \\sqrt{{v_0^2 + 2gh}} = {v_f:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, t_approx], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": knowns.get("v0", 0) * DISPLAY_SCALE, "c2": 0.5 * g * DISPLAY_SCALE}}
                ], "vectors": []},
            },
        ]

    elif domain == "momentum":
        v_f = float(solved.get("v_f", 0))
        m1 = knowns.get("m1", 1)
        m2 = knowns.get("m2", 1)
        v1 = knowns.get("v1", 5)
        return [
            {
                "step_id": 1, "concept": "Conservation of Momentum",
                "explanation": "Total momentum is conserved in all collisions.",
                "math_latex": "m_1 v_1 + m_2 v_2 = (m_1 + m_2)v_f",
                "simulation_state": {"time_range": [0, 0], "animations": [
                    {"target": "object1", "type": "polynomial", "params": {"c0": -DISPLAY_SCALE * 2, "c1": v1 * DISPLAY_SCALE, "c2": 0}},
                ], "vectors": []},
            },
            {
                "step_id": 2, "concept": "Final Velocity After Collision",
                "explanation": f"v_f = (m₁v₁ + m₂v₂)/(m₁+m₂) = {v_f:.3f} m/s",
                "math_latex": f"v_f = \\frac{{m_1 v_1 + m_2 v_2}}{{m_1 + m_2}} = {v_f:.3f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 2], "animations": [
                    {"target": "object", "type": "polynomial", "params": {"c0": 0, "c1": v_f * DISPLAY_SCALE, "c2": 0}},
                ], "vectors": []},
            },
        ]

    elif domain == "kinematics_2d_projectile":
        t_flight = float(solved.get("t_flight", 1))
        x_max = float(solved.get("x_max", 10))
        return [
            {
                "step_id": 1, "concept": "Decompose Initial Velocity",
                "explanation": f"Split v₀ into components: v₀ₓ = {solved.get('v0x', 0):.2f} m/s, v₀ᵧ = {solved.get('v0y', 0):.2f} m/s",
                "math_latex": f"v_{{0x}} = v_0\\cos\\theta = {solved.get('v0x', 0):.2f}\\,\\text{{m/s}}, \\quad v_{{0y}} = v_0\\sin\\theta = {solved.get('v0y', 0):.2f}\\,\\text{{m/s}}",
                "simulation_state": {"time_range": [0, 0], "animations": [], "vectors": [
                    {"label": "v₀ₓ", "direction": [1, 0], "magnitude": solved.get("v0x", 0), "color": "#3b82f6"},
                    {"label": "v₀ᵧ", "direction": [0, 1], "magnitude": solved.get("v0y", 0), "color": "#22c55e"},
                ]},
            },
            {
                "step_id": 2, "concept": "Time of Flight",
                "explanation": f"Solving for when y = 0: t_flight = {t_flight:.3f} s",
                "math_latex": f"t_{{\\text{{flight}}}} = {t_flight:.3f}\\,\\text{{s}}",
                "simulation_state": {"time_range": [0, t_flight], "animations": [
                    {"target": "object", "type": "projectile", "params": {
                        "v0x": solved.get("v0x", 0), "v0y": solved.get("v0y", 0), "g": knowns.get("g", 9.81)
                    }}
                ], "vectors": []},
            },
            {
                "step_id": 3, "concept": "Range",
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
    solver = DOMAIN_SOLVERS.get(req.domain)
    if not solver:
        raise HTTPException(status_code=422, detail=f"No solver for domain: {req.domain}")

    try:
        solved = solver(req.knowns, req.unknowns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SymPy solver error: {str(e)}")

    steps = build_steps_for_domain(req.domain, req.knowns, solved, req.object_type)

    # Latex results for display
    latex = {k: f"{v:.4g}" for k, v in solved.items() if isinstance(v, (int, float))}

    return SolveResponse(solved=solved, solution_steps=steps, latex_results=latex)
