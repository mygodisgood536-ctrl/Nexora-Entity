import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '../src/http';

describe('isPrivateAddress', () => {
  it('rejects loopback on IPv4', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('127.255.255.254')).toBe(true);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
  });

  it('does not reject the whole 172 range, only the private part', () => {
    // 172.15 and 172.32 are outside RFC1918; treating them as private would break real sites.
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
  });

  it('rejects link-local, including the cloud metadata address', () => {
    expect(isPrivateAddress('169.254.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('rejects carrier-grade NAT', () => {
    expect(isPrivateAddress('100.64.0.1')).toBe(true);
    expect(isPrivateAddress('100.127.255.255')).toBe(true);
  });

  it('rejects the unspecified and this-network ranges', () => {
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('0.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.0.0.1')).toBe(true);
  });

  it('rejects multicast and reserved space', () => {
    expect(isPrivateAddress('224.0.0.1')).toBe(true);
    expect(isPrivateAddress('239.255.255.255')).toBe(true);
    expect(isPrivateAddress('255.255.255.255')).toBe(true);
  });

  it('accepts ordinary public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('172.14.0.1')).toBe(false);
    expect(isPrivateAddress('100.63.255.255')).toBe(false);
  });

  it('rejects loopback and unspecified on IPv6', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
  });

  it('rejects IPv6 unique-local and link-local', () => {
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('unwraps IPv4-mapped IPv6 and applies the IPv4 rules', () => {
    // ::ffff:127.0.0.1 is loopback; treating the prefix as public would be an SSRF hole.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('accepts a public IPv6 address', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('rejects a malformed address rather than defaulting to public', () => {
    // Failing closed is the only safe default for an unparseable host.
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('999.1.1.1')).toBe(true);
    expect(isPrivateAddress('10.0.0')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });

  it('rejects an IPv4 address with a non-numeric part', () => {
    expect(isPrivateAddress('10.0.0.abc')).toBe(true);
  });
});
