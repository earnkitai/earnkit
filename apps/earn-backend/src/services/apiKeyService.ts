import { createHash, randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';

export class ApiKeyService {
  private static hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private static prefixOf(rawKey: string): string {
    // e.g. "ek_" + first 8 hex chars → "ek_a1b2c3d4"
    return rawKey.substring(0, 11);
  }

  /**
   * Generate a new API key. Returns the plaintext key — shown only once.
   * Stores SHA-256 hash + prefix in DB.
   */
  static async generateApiKey(userId: string): Promise<string> {
    const rawKey = `ek_${randomBytes(20).toString('hex')}`;
    const hash = this.hashKey(rawKey);
    const prefix = this.prefixOf(rawKey);

    await prisma.user.update({
      where: { id: userId },
      data: { apiKey: hash, apiKeyPrefix: prefix },
    });

    return rawKey;
  }

  /** Regenerate — invalidates the existing key. */
  static async regenerateApiKey(userId: string): Promise<string> {
    return this.generateApiKey(userId);
  }

  /** Revoke — clears both hash and prefix. */
  static async revokeApiKey(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { apiKey: null, apiKeyPrefix: null },
    });
  }

  /**
   * Look up a user by a raw (plaintext) API key.
   * Hashes the key before querying.
   */
  static async getUserByApiKey(rawKey: string) {
    const hash = this.hashKey(rawKey);
    return prisma.user.findUnique({
      where: { apiKey: hash },
      select: {
        id: true,
        username: true,
        email: true,
        apiKeyPrefix: true,
        createdAt: true,
      },
    });
  }

  static async isApiKeyValid(rawKey: string): Promise<boolean> {
    const user = await this.getUserByApiKey(rawKey);
    return !!user;
  }
}
