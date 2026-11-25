import { describe, expect, it } from 'vitest';
import { resetLink } from '../src/common/links';

describe('reset links', () => {
  it('points at the web app, keeping a path prefix when the app is served under one', () => {
    expect(resetLink('https://app.example.com', 'abc')).toBe('https://app.example.com/reset-password?token=abc');
    expect(resetLink('https://app.example.com/', 'abc')).toBe('https://app.example.com/reset-password?token=abc');
    expect(resetLink('https://shop.example.com/velora', 'abc')).toBe('https://shop.example.com/velora/reset-password?token=abc');
    expect(resetLink('https://shop.example.com/velora/', 'a+b/c=')).toBe('https://shop.example.com/velora/reset-password?token=a%2Bb%2Fc%3D');
  });
});
