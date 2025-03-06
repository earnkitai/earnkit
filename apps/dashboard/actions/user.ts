'use server';

import { UserService } from '@/lib/services/user.service';
import { initializeDatabase } from '@/lib/db';
import { User } from '@/types/user';

// Helper function to serialize user data
function serializeUser(user: User | null) {
  if (!user) return null;
  return {
    turnkeyUserId: user.turnkeyUserId,
    username: user.username,
    email: user.email,
    turnkeyOrganizationId: user.turnkeyOrganizationId,
    walletAddress: user.walletAddress,
    isVerified: user.isVerified,
    isActive: user.isActive,
    hasPasskey: user.hasPasskey,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getUserByEmail(email: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.getUserByEmail(email);
    return { success: true, data: serializeUser(user) };
  } catch (error) {
    console.error('Error fetching user by email:', error);
    return { success: false, error: 'Failed to fetch user' };
  }
}

export async function createUser(userData: Partial<User>) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.createUser(userData);
    return { success: true, data: serializeUser(user) };
  } catch (error) {
    console.error('Error creating user:', error);
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Failed to create user' };
  }
}

export async function checkUsername(username: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.getUserByUsername(username);
    return { success: true, available: !user };
  } catch (error) {
    console.error('Error checking username:', error);
    return { success: false, error: 'Failed to check username' };
  }
}

export async function updateUsername(turnkeyUserId: string, username: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.updateUser(turnkeyUserId, { username });
    return { success: true, data: serializeUser(user) };
  } catch (error) {
    console.error('Error updating username:', error);
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Failed to update username' };
  }
}

export async function getUserByTurnkeyId(turnkeyUserId: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.getUserByTurnkeyId(turnkeyUserId);
    return { success: true, data: serializeUser(user) };
  } catch (error) {
    console.error('Error fetching user by Turnkey ID:', error);
    return { success: false, error: 'Failed to fetch user' };
  }
}

export async function getUserEmailByUsername(username: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.getUserByUsername(username);
    return { success: true, email: user?.email || null };
  } catch (error) {
    console.error('Error fetching user email by username:', error);
    return { success: false, error: 'Failed to fetch user email' };
  }
}

export async function getUsernameByUserId(userId: string) {
  try {
    await initializeDatabase();
    const userService = new UserService();
    const user = await userService.getUserByTurnkeyId(userId);
    return { success: true, username: user?.username || null };
  } catch (error) {
    console.error('Error fetching username by userId:', error);
    return { success: false, error: 'Failed to fetch username' };
  }
}
