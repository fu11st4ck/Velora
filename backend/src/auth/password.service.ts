import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Errors } from '../common/errors';

// OWASP-aligned Argon2id parameters (docs/security-guidelines.md §1).
const OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/**
 * A short deny-list of the most common passwords of sufficient length. This is a floor, not a
 * breach check; a k-anonymity breach lookup is planned for Sprint 6 (docs/security-guidelines.md).
 */
const COMMON = new Set([
  'password12', 'password123', 'password1234', '1234567890', '12345678910', '0123456789', 'qwertyuiop',
  'qwerty12345', 'qwerty123456', '1q2w3e4r5t', '1q2w3e4r5t6y', 'iloveyou123', 'letmein12345', 'welcome12345',
  'administrator', 'passw0rd123', 'abcdefghij', 'abc1234567', '1111111111', '0000000000', 'changeme123',
]);

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Spends the same time as a real verification, so unknown accounts are not distinguishable by timing. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('velora-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /** Throws WEAK_PASSWORD when the policy is not met. */
  assertAcceptable(password: string, context: { email: string }): void {
    if (password.length < 10) throw Errors.weakPassword('min_length_10');
    if (password.length > 200) throw Errors.weakPassword('max_length_200');
    const lower = password.toLowerCase();
    if (COMMON.has(lower)) throw Errors.weakPassword('too_common');
    if (new Set(lower).size < 4) throw Errors.weakPassword('too_repetitive');
    const local = context.email.split('@')[0]?.toLowerCase() ?? '';
    if (local.length >= 4 && lower.includes(local)) throw Errors.weakPassword('contains_email');
  }
}
