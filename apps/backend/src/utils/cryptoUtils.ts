import crypto from "crypto";

/**
 * Generate a hashed version of the API key
 * @param apiKey The original API key
 * @returns The hashed API key
 */
export const hashApiKey = (apiKey: string): string => {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
};

/**
 * Generate a random API key (using UUID as a basic example)
 * @returns A random API key
 */
export const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString("hex"); // 64 character key
};

export const validateApiKey = (apiKey: string, hashedKey: string): boolean => {
  const hash = hashApiKey(apiKey);
  return hash === hashedKey;
};
