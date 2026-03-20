import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from openai import OpenAI
import sympy as sp
import json

app = FastAPI()

# Make sure to set OPENAI_API_KEY in .env.local
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

class ProblemRequest(BaseModel):
    problem: str

@app.post("/api/solve")
def solve_problem(req: ProblemRequest):
    if not client.api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set.")
    
    # --- STEP 1: LLM Parsing ---
    # We ask the LLM to extract knowns, unknowns, and the required equation in Python syntax.
    system_prompt = """You are a physics expert parser. Translate the user's physics word problem into a strict JSON payload.
    Equations must be valid SymPy parseable expressions (e.g., 'd', 'v_0*t + 0.5*a*t**2').
    Return JSON only:
    {
      "objects": [{"id": "name", "type": "point_mass | thin_disk | etc"}],
      "knowns": {"var_name": float_value, ...},
      "solve_for": "var_name",
      "equation_lhs": "left hand side of equation",
      "equation_rhs": "right hand side of equation",
      "concept": "Name of the physics concept used"
    }
    """
    
    try:
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": req.problem}
            ],
            response_format={"type": "json_object"}
        )
        parsed = json.loads(completion.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM Parsing failed: {str(e)}")

    # --- STEP 2: SymPy Solving ---
    try:
        lhs_expr = sp.sympify(parsed["equation_lhs"])
        rhs_expr = sp.sympify(parsed["equation_rhs"])
        eq = sp.Eq(lhs_expr, rhs_expr)
        
        # Substitute the known variables
        subs_dict = {}
        for var_name, var_value in parsed["knowns"].items():
            subs_dict[sp.Symbol(var_name)] = var_value
            
        eq_subbed = eq.subs(subs_dict)
        
        # Solve for the unknown variable
        unknown_sym = sp.Symbol(parsed["solve_for"])
        solutions = sp.solve(eq_subbed, unknown_sym)
        
        if len(solutions) == 0:
            final_answer = "No solution found"
        else:
            final_answer = float(solutions[0].evalf())
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SymPy Solving failed: {str(e)}")

    # --- STEP 3: Return Structured Steps for Frontend ---
    latex_eq = sp.latex(eq)
    latex_subbed = sp.latex(eq_subbed)
    
    # Very basic naive extraction for 1D Kinematics MVP
    # If the user asks about acceleration, a, v0, t, d...
    # We will build a simple parametric function for the frontend 
    # y(t) = v0*t + 0.5*a*t^2 (or similar)
    
    a_val = parsed["knowns"].get("a", 0)
    v0_val = parsed["knowns"].get("v_0", parsed["knowns"].get("v0", 0))
    t_val = parsed["knowns"].get("t", 5) 
    if "t" not in parsed["knowns"] and parsed["solve_for"] == "t":
        t_val = final_answer if final_answer != "No solution found" else 5

    steps = [
        {
            "step_id": 1,
            "concept": "Identify Variables",
            "explanation": "From the problem, we extract the given values.",
            "math_latex": ", ".join([f"{k} = {v}" for k, v in parsed["knowns"].items()]) + f", {parsed['solve_for']} = ?",
            "simulation_state": {
                "time_range": [0, 0],
                "visible_objects": ["main_object"],
                "vectors": []
            }
        },
        {
            "step_id": 2,
            "concept": parsed["concept"],
            "explanation": "We use the associated physics equation.",
            "math_latex": latex_eq,
             "simulation_state": {
                "time_range": [0, 0],
                "visible_objects": ["main_object"],
                "vectors": [
                    { "origin_id": "main_object", "direction": [1, 0], "magnitude": "v0", "label": f"v0={v0_val}", "color": "#10B981" }
                ] if v0_val > 0 else []
            }
        },
        {
            "step_id": 3,
            "concept": "Substitute & Solve",
            "explanation": "Plug in the knowns and solve for the unknown.",
            "math_latex": f"{sp.latex(unknown_sym)} = {final_answer}",
            "simulation_state": {
                "time_range": [0, t_val],
                "animations": [
                    {
                        "target": "main_object",
                        "property": "position_x",
                        "function": "parametric",
                        "equation": f"{v0_val}*t + 0.5*{a_val}*t*t"
                    }
                ]
            }
        }
    ]

    return {
        "problem": req.problem,
        "parsed": parsed,
        "solution_steps": steps,
        "final_answer": final_answer
    }
