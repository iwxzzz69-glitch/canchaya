/** Ventana deslizante: como máximo `limit` acciones cada `windowMs`. */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    const t = this.now();
    while (this.hits.length && this.hits[0] <= t - this.windowMs) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(t);
    return true;
  }
}
