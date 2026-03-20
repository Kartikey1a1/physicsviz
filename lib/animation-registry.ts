/**
 * ANIMATION_REGISTRY
 *
 * The single lookup table for all parametric motion functions.
 * The frontend does NOT know any physics — it only evaluates these functions.
 *
 * Backend sends: { "type": "harmonic", "params": { "A": 5, "omega": 3.14, "phi": 0 } }
 * Frontend calls: ANIMATION_REGISTRY["harmonic"](t, params) → position
 */

export type AnimationType = "polynomial" | "harmonic" | "rotate" | "circular";

export interface CircularPos { x: number; y: number }

export type AnimationFn =
  | ((t: number, p: Record<string, number>) => number)
  | ((t: number, p: Record<string, number>) => CircularPos);

export const ANIMATION_REGISTRY: Record<string, (t: number, p: Record<string, number>) => number | CircularPos> = {
  /**
   * Polynomial (1D kinematics, constant acceleration)
   * x(t) = c0 + c1*t + c2*t²
   * params: { c0: x0, c1: v0, c2: 0.5*a }
   */
  polynomial: (t, p) => p.c0 + p.c1 * t + p.c2 * t ** 2,

  /**
   * Simple Harmonic Motion
   * x(t) = A * cos(ω*t + φ)
   * params: { A, omega, phi }
   */
  harmonic: (t, p) => p.A * Math.cos(p.omega * t + p.phi),

  /**
   * Rotational / Angular Kinematics
   * θ(t) = c0 + c1*t + c2*t²  (degrees or radians, caller decides)
   * params: { c0: theta0, c1: omega0, c2: 0.5*alpha }
   */
  rotate: (t, p) => p.c0 + p.c1 * t + p.c2 * t ** 2,

  /**
   * Uniform Circular Motion (returns 2D position)
   * x(t) = r * cos(ω*t),  y(t) = r * sin(ω*t)
   * params: { r, omega, x_center?, y_center? }
   */
  circular: (t, p): CircularPos => ({
    x: (p.x_center ?? 0) + p.r * Math.cos(p.omega * t),
    y: (p.y_center ?? 0) + p.r * Math.sin(p.omega * t),
  }),

  /**
   * Projectile (2D, returns { x, y })
   * x(t) = v0x * t
   * y(t) = v0y * t - 0.5 * g * t²
   * params: { v0x, v0y, g }
   */
  projectile: (t, p): CircularPos => ({
    x: p.v0x * t,
    y: p.v0y * t - 0.5 * p.g * t ** 2,
  }),
};

/** Type guard to check if a registry result is a 2D position */
export function is2DPos(val: number | CircularPos): val is CircularPos {
  return typeof val === "object" && "x" in val && "y" in val;
}
