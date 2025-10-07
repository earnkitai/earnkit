import { prisma } from '../lib/prisma';
import { v4 as uuidv4 } from 'uuid';

export class ApiKeyService {
  /**
   * Generate a new API key for a user
   */
  static async generateApiKey(userId: string): Promise<string> {
    // Generate a unique API key
    const apiKey = `ek_${uuidv4().replace(/-/g, '')}`;

    // Update the user with the new API key
    await prisma.user.update({
      where: { id: userId },
      data: { apiKey },
    });

    return apiKey;
  }

  /**
   * Regenerate API key for a user (invalidates the old one)
   */
  static async regenerateApiKey(userId: string): Promise<string> {
    return this.generateApiKey(userId);
  }

  /**
   * Revoke API key for a user
   */
  static async revokeApiKey(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { apiKey: null },
    });
  }

  /**
   * Get user by API key
   */
  static async getUserByApiKey(apiKey: string) {
    return prisma.user.findUnique({
      where: { apiKey },
      select: {
        id: true,
        username: true,
        email: true,
        apiKey: true,
        createdAt: true,
      },
    });
  }

  /**
   * Check if API key is valid
   */
  static async isApiKeyValid(apiKey: string): Promise<boolean> {
    const user = await this.getUserByApiKey(apiKey);
    return !!user;
  }
}
