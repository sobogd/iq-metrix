import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// scrypt password hashing for the single admin user (ADMIN_PASSWORD_HASH).
// Stored format: "<hex salt>:<hex derived key>" — see README.md for the
// `node -e` one-liner that generates this using the exact same function.

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${derived}`;
}

/** Constant-time verification against a "<salt>:<derived>" stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const sepIndex = stored.indexOf(":");
  if (sepIndex === -1) return false;
  const salt = stored.slice(0, sepIndex);
  const expectedHex = stored.slice(sepIndex + 1);
  if (!salt || !expectedHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  const candidate = scryptSync(password, salt, KEY_LEN);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
