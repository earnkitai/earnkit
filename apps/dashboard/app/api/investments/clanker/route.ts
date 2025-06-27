import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

const LIMIT_ORDERS_API_KEY = process.env.LIMIT_ORDERS_API_KEY;
const LIMIT_ORDERS_BASE_URL = process.env.LIMIT_ORDERS_BASE_URL;

function calculateRiskLevel(percentage: number): string {
  if (percentage <= 15) return '0';
  if (percentage < 50) return '25';
  if (percentage < 75) return '50';
  if (percentage < 100) return '75';
  return '100';
}

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

    // Calculate risk level based on percentage
    const percentageNum = parseFloat(percentage);
    const risk = calculateRiskLevel(percentageNum);

    // Make the API call to the external service
    const response = await fetch(
      `${LIMIT_ORDERS_BASE_URL}/api/clanker/trending?amount=${amountInWei.toString()}&risk=${risk}`,
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
    console.error('Error in Clanker trending API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Clanker trending tokens' },
      { status: 500 },
    );
  }
}
