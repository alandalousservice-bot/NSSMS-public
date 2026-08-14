import { describe, expect, it } from 'vitest';
import { assertTransition } from '../src/domain/lifecycle.js';
describe('lifecycle transitions', () => {
  it('accepts documented season progression', () => expect(() => assertTransition('season', 'DRAFT', 'UNDER_REVIEW')).not.toThrow());
  it('rejects invalid transitions', () => expect(() => assertTransition('season', 'DRAFT', 'ACTIVE')).toThrow());
});
