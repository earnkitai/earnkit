'use server';

import { prisma } from '@/lib/prisma';
import { OrderDirection, OrderType } from '@prisma/client';

export type CreateLimitOrderInput = {
  userId: string;
  userAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimal: number;
  amount: string;
  priceAtCreation: string;
  targetPrice?: string;
  targetChange?: number;
  direction: OrderDirection;
  orderType?: OrderType;
  aiInitiated?: boolean;
  notes?: string;
};

export type CreateOrderHistoryInput = CreateLimitOrderInput & {
  executedAt: Date;
  executedPrice: string;
};

export async function createLimitOrder(data: CreateLimitOrderInput) {
  const order = await prisma.limitOrder.create({
    data: {
      userId: data.userId,
      userAddress: data.userAddress,
      tokenAddress: data.tokenAddress,
      tokenSymbol: data.tokenSymbol,
      tokenDecimal: data.tokenDecimal,
      amount: data.amount,
      priceAtCreation: data.priceAtCreation,
      targetPrice: data.targetPrice,
      targetChange: data.targetChange,
      direction: data.direction,
      orderType: data.orderType || OrderType.LIMIT,
      aiInitiated: data.aiInitiated || false,
      notes: data.notes,
    },
  });

  return order;
}

export async function getLimitOrdersByUserId(userId: string) {
  const orders = await prisma.limitOrder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  return orders;
}

export async function getLimitOrderById(id: string) {
  const order = await prisma.limitOrder.findUnique({
    where: { id },
  });

  return order;
}

export async function deleteLimitOrder(id: string) {
  await prisma.limitOrder.delete({ where: { id } });
  return true;
}

export async function createOrderHistory(data: CreateOrderHistoryInput) {
  const order = await prisma.orderHistory.create({
    data: {
      userId: data.userId,
      userAddress: data.userAddress,
      tokenAddress: data.tokenAddress,
      tokenSymbol: data.tokenSymbol,
      tokenDecimal: data.tokenDecimal,
      amount: data.amount,
      priceAtCreation: data.priceAtCreation,
      targetPrice: data.targetPrice,
      targetChange: data.targetChange,
      direction: data.direction,
      orderType: data.orderType || OrderType.LIMIT,
      createdAt: new Date(),
      executedAt: data.executedAt,
      executedPrice: data.executedPrice,
      aiInitiated: data.aiInitiated || false,
      notes: data.notes,
    },
  });

  return order;
}

export async function getOrderHistoryByUserId(userId: string) {
  const orders = await prisma.orderHistory.findMany({
    where: { userId },
    orderBy: { executedAt: 'desc' },
  });

  return orders;
}

export async function getOrderHistoryById(id: string) {
  const order = await prisma.orderHistory.findUnique({
    where: { id },
  });

  return order;
}
