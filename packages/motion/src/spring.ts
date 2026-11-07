/**
 * Damped spring, stepped by `FixedStep` (semi-implicit Euler; stable while ω·h is small: the
 * stiffest preset has ω·h ≈ 0.1 at 240 Hz).
 */
export interface SpringConfig {
  /** Natural angular frequency, rad/s. Higher = faster. */
  readonly omega: number;
  /** Damping ratio: 1 = critically damped (no overshoot), < 1 bounces. */
  readonly zeta: number;
}

export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    value: number,
    public config: SpringConfig,
  ) {
    this.value = value;
    this.target = value;
  }

  step(h: number): void {
    const { omega, zeta } = this.config;
    const a = -omega * omega * (this.value - this.target) - 2 * zeta * omega * this.velocity;
    this.velocity += a * h;
    this.value += this.velocity * h;
  }

  /** At rest within `eps` of the target (value and velocity). */
  settled(eps = 1e-3): boolean {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps;
  }

  /** Jump to the target and stop (reduced motion, or a settled spring snapping exactly). */
  snap(): void {
    this.value = this.target;
    this.velocity = 0;
  }
}
