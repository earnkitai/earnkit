import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

// Environment variables are only accessible on the server side
const LIMIT_ORDERS_API_KEY = process.env.LIMIT_ORDERS_API_KEY;
const LIMIT_ORDERS_BASE_URL = process.env.LIMIT_ORDERS_BASE_URL;

export async function GET(request: Request) {
  try {
    // Get URL parameters
    const { searchParams } = new URL(request.url);
    const amount = searchParams.get('amount');
    const percentage = searchParams.get('percentage');

    if (!amount || !percentage) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 },
      );
    }

    // Convert amount to wei
    const amountInWei = ethers.parseEther(amount);

    // Determine risk level based on percentage
    const percentageNum = parseFloat(percentage);
    const risk = percentageNum < 25 ? 'low' : 'high';

    // Make the API call to the external service
    const response = await fetch(
      `${LIMIT_ORDERS_BASE_URL}/api/investments/recommendations?amount=${amountInWei.toString()}&risk=${risk}`,
      {
        headers: {
          'x-api-key': LIMIT_ORDERS_API_KEY || '',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in recommendations API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recommendations' },
      { status: 500 },
    );
  }
}
