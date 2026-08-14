import { describe, expect, it } from 'vitest';
import { createVerificationReference, hashVerificationReference } from '../src/services/verification.js';

describe('QR verification references', () => {
  it('creates opaque references and one-way hashes', () => {
    const reference = createVerificationReference();
    expect(reference.length).toBeGreaterThan(20);
    expect(hashVerificationReference(reference)).toHaveLength(64);
    expect(hashVerificationReference(reference)).not.toBe(reference);
  });
  it('does not produce the same reference twice', () => {
    expect(createVerificationReference()).not.toBe(createVerificationReference());
  });
  it('supports deterministic hashing for lookup', () => {
    const reference = createVerificationReference();
    expect(hashVerificationReference(reference)).toBe(hashVerificationReference(reference));
  });
});
