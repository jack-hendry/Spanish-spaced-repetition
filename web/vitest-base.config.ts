import { defineConfig } from 'vitest/config';

// Merged into the Angular unit-test builder's own Vitest config (runnerConfig).
// Shuffling surfaces specs that silently depend on run order; Vitest prints the
// seed, so a failing order can be replayed with `--sequence.seed=<seed>`.
export default defineConfig({
  test: {
    sequence: { shuffle: true },
  },
});
