/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

// Uniswap V4 contract addresses for Base
const QUOTER_ADDRESS = '0x0d5e0f971ed27fbff6c2837bf31316121532048d'; // Base Quoter
const ROUTER_ADDRESS = '0x6ff5693b99212da76ad316178a184ab56d299b43'; // Base Router
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // Base WETH

// Provider setup
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');

// Quoter ABI for V4
const quoterABI = [
  {
    inputs: [
      {
        internalType: 'contract IPoolManager',
        name: '_poolManager',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'PoolId', name: 'poolId', type: 'bytes32' }],
    name: 'NotEnoughLiquidity',
    type: 'error',
  },
  { inputs: [], name: 'NotPoolManager', type: 'error' },
  { inputs: [], name: 'NotSelf', type: 'error' },
  {
    inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }],
    name: 'QuoteSwap',
    type: 'error',
  },
  { inputs: [], name: 'UnexpectedCallSuccess', type: 'error' },
  {
    inputs: [{ internalType: 'bytes', name: 'revertData', type: 'bytes' }],
    name: 'UnexpectedRevertBytes',
    type: 'error',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'exactCurrency', type: 'address' },
          {
            components: [
              {
                internalType: 'Currency',
                name: 'intermediateCurrency',
                type: 'address',
              },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
              { internalType: 'bytes', name: 'hookData', type: 'bytes' },
            ],
            internalType: 'struct PathKey[]',
            name: 'path',
            type: 'tuple[]',
          },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: '_quoteExactInput',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'Currency', name: 'currency0', type: 'address' },
              { internalType: 'Currency', name: 'currency1', type: 'address' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
            ],
            internalType: 'struct PoolKey',
            name: 'poolKey',
            type: 'tuple',
          },
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
          { internalType: 'bytes', name: 'hookData', type: 'bytes' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: '_quoteExactInputSingle',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'exactCurrency', type: 'address' },
          {
            components: [
              {
                internalType: 'Currency',
                name: 'intermediateCurrency',
                type: 'address',
              },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
              { internalType: 'bytes', name: 'hookData', type: 'bytes' },
            ],
            internalType: 'struct PathKey[]',
            name: 'path',
            type: 'tuple[]',
          },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: '_quoteExactOutput',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'Currency', name: 'currency0', type: 'address' },
              { internalType: 'Currency', name: 'currency1', type: 'address' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
            ],
            internalType: 'struct PoolKey',
            name: 'poolKey',
            type: 'tuple',
          },
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
          { internalType: 'bytes', name: 'hookData', type: 'bytes' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: '_quoteExactOutputSingle',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'poolManager',
    outputs: [
      { internalType: 'contract IPoolManager', name: '', type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'exactCurrency', type: 'address' },
          {
            components: [
              {
                internalType: 'Currency',
                name: 'intermediateCurrency',
                type: 'address',
              },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
              { internalType: 'bytes', name: 'hookData', type: 'bytes' },
            ],
            internalType: 'struct PathKey[]',
            name: 'path',
            type: 'tuple[]',
          },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInput',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'Currency', name: 'currency0', type: 'address' },
              { internalType: 'Currency', name: 'currency1', type: 'address' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
            ],
            internalType: 'struct PoolKey',
            name: 'poolKey',
            type: 'tuple',
          },
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
          { internalType: 'bytes', name: 'hookData', type: 'bytes' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountOut', type: 'uint256' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'Currency', name: 'exactCurrency', type: 'address' },
          {
            components: [
              {
                internalType: 'Currency',
                name: 'intermediateCurrency',
                type: 'address',
              },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
              { internalType: 'bytes', name: 'hookData', type: 'bytes' },
            ],
            internalType: 'struct PathKey[]',
            name: 'path',
            type: 'tuple[]',
          },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactOutput',
    outputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { internalType: 'Currency', name: 'currency0', type: 'address' },
              { internalType: 'Currency', name: 'currency1', type: 'address' },
              { internalType: 'uint24', name: 'fee', type: 'uint24' },
              { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
              {
                internalType: 'contract IHooks',
                name: 'hooks',
                type: 'address',
              },
            ],
            internalType: 'struct PoolKey',
            name: 'poolKey',
            type: 'tuple',
          },
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'uint128', name: 'exactAmount', type: 'uint128' },
          { internalType: 'bytes', name: 'hookData', type: 'bytes' },
        ],
        internalType: 'struct IV4Quoter.QuoteExactSingleParams',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactOutputSingle',
    outputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes', name: 'data', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

// Router ABI for V4
const routerABI = [
  'function exactInputSingle((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
];

interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

interface QuoteParams {
  poolKey: PoolKey;
  zeroForOne: boolean;
  exactAmount: string;
  hookData: string;
}

interface QuoteResult {
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  gasEstimate: bigint;
}

// Create contract instances
const quoterContract = new ethers.Contract(QUOTER_ADDRESS, quoterABI, provider);
const routerContract = new ethers.Contract(ROUTER_ADDRESS, routerABI, provider);

async function getQuote(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: string,
): Promise<QuoteResult> {
  // Construct pool key for V4
  const poolKey: PoolKey = {
    currency0: tokenIn,
    currency1: tokenOut,
    fee: fee,
    tickSpacing: 10, // Default tick spacing for 0.3% fee tier
    hooks: '0x0000000000000000000000000000000000000000', // No hooks
  };

  try {
    // Use callStatic to simulate the quote without actually executing the transaction
    const quote = await quoterContract.callStatic.quoteExactInputSingle({
      poolKey,
      zeroForOne: true, // true for tokenIn -> tokenOut
      exactAmount: amountIn,
      hookData: '0x00', // No hook data
    } as QuoteParams);

    return {
      amountOut: quote.amountOut,
      sqrtPriceX96After: quote.sqrtPriceX96After,
      gasEstimate: quote.gasEstimate,
    };
  } catch (error) {
    console.error('Quote failed:', error);
    throw error;
  }
}

async function getSwapData(
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: string,
  amountOutMinimum: string,
  recipient: string,
) {
  // Construct pool key for V4
  const poolKey: PoolKey = {
    currency0: tokenIn,
    currency1: tokenOut,
    fee: fee,
    tickSpacing: 10, // Default tick spacing for 0.3% fee tier
    hooks: '0x0000000000000000000000000000000000000000', // No hooks
  };

  const params = {
    poolKey,
    recipient,
    amountIn,
    amountOutMinimum,
  };

  // Encode the function call
  const encodedData = routerContract.interface.encodeFunctionData(
    'exactInputSingle',
    [params],
  );

  return encodedData;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userAddress, tokenOutAddress, amountIn } = body;

    const fee = 3000; // 0.3% fee tier
    const slippageTolerance = 0.5; // 0.5%

    // 1. Get quote
    const quote = await getQuote(WETH_ADDRESS, tokenOutAddress, fee, amountIn);

    // 2. Calculate minimum amount out with slippage
    const slippageMultiplier = (100 - slippageTolerance) / 100;
    const amountOutMinimum =
      (quote.amountOut * BigInt(Math.floor(slippageMultiplier * 100))) /
      BigInt(100);

    // 3. Generate encoded swap data
    const encodedData = await getSwapData(
      WETH_ADDRESS,
      tokenOutAddress,
      fee,
      amountIn,
      amountOutMinimum.toString(),
      userAddress,
    );

    return NextResponse.json({
      quote: quote.amountOut.toString(),
      estimatedGasUsed: quote.gasEstimate.toString(),
      methodParameters: {
        to: ROUTER_ADDRESS,
        data: encodedData,
        value: amountIn,
      },
    });
  } catch (error) {
    console.error('Error in swap route:', error);
    return NextResponse.json(
      { error: 'Failed to get swap route' },
      { status: 500 },
    );
  }
}
