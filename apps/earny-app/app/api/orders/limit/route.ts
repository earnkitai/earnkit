import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/db';
import { createLimitOrder, getLimitOrdersByUserId } from '@/actions/order';

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const orderData = await request.json();

    if (!orderData.userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    const order = await createLimitOrder(orderData);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error('Error creating limit order:', error);
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to create limit order' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 },
      );
    }

    const orders = await getLimitOrdersByUserId(userId);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error('Error fetching limit orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch limit orders' },
      { status: 500 },
    );
  }
}
