// Global test setup, registered via `setupFiles` in angular.json.
// Every spec starts and ends with empty Web Storage, so state written by one
// spec (or by a service still draining after its test ended) can never leak
// into the next one.
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
