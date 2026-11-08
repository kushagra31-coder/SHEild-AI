import * as Crypto from "expo-crypto";

/**
 * Generates an RFC 4122 compliant version 4 UUID using a cryptographically
 * secure random number generator (expo-crypto backed by Android SecureRandom / iOS SecRandomCopyBytes).
 * 
 * Guarantees uniqueness and security without fallback to Math.random() or timestamps.
 */
export function generateSecureUUID(): string {
  try {
    if (Crypto && typeof Crypto.randomUUID === "function") {
      return Crypto.randomUUID();
    }
  } catch (_e) {
    // Safe fallback to uuid package with global crypto.getRandomValues polyfill
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { v4: uuidv4 } = require("uuid");
  return uuidv4();
}

