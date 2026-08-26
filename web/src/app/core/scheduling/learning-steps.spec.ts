import { describe, expect, it } from 'vitest';
import { clampLeft } from './learning-steps';

describe('clampLeft', () => {
  it('treats 0 as "start at the top" and returns the step count', () => {
    expect(clampLeft(0, 3)).toBe(3);
  });

  it('treats NaN as "start at the top" and returns the step count', () => {
    expect(clampLeft(NaN, 3)).toBe(3);
  });

  it('passes through a value already inside the range', () => {
    expect(clampLeft(2, 3)).toBe(2);
  });

  it('clamps a stale left down to the shortened step count', () => {
    expect(clampLeft(3, 1)).toBe(1);
  });

  it('clamps a negative left up to 1', () => {
    expect(clampLeft(-2, 3)).toBe(1);
  });

  it('always returns a value within [1, stepCount]', () => {
    for (let left = -1; left <= 5; left++) {
      for (let stepCount = 1; stepCount <= 3; stepCount++) {
        const result = clampLeft(left, stepCount);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(stepCount);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });
});
