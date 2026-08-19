import { generateSecureToken, hashSecureToken } from './secure-token.util';

describe('secure-token.util', () => {
  it('generateSecureToken произвежда различни, URL-safe стойности', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 байта base64url ≈ 43 символа без padding
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it('hashSecureToken е детерминиран SHA-256 хекс', () => {
    const token = 'fixed-token-value';
    const hash1 = hashSecureToken(token);
    const hash2 = hashSecureToken(token);
    expect(hash1).toEqual(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('различни токени дават различни хешове', () => {
    expect(hashSecureToken('a')).not.toEqual(hashSecureToken('b'));
  });
});
