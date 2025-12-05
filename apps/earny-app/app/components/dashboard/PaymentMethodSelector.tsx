'use client';

import { useState, useEffect } from 'react';

// Types matching the backend API response
interface TopUpOption {
  label: string;
  amountInUSD: string;
  amountInEth?: string;
  value?: string; // WEI for ETH
  amountInToken?: string;
  amountInTokenHumanReadable?: string;
  creditsToTopUp?: number;
}

interface SupportedTokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  logoUrl?: string;
}

interface PaymentMethod {
  type: 'eth' | 'token';
  token?: SupportedTokenInfo;
  options: TopUpOption[];
  contractFunction: {
    name: string;
    signature: string;
    approveRequired?: boolean;
  };
}

interface EscrowContract {
  address: string;
  depositFunction: {
    name: string;
    signature: string;
    agentIdParam: string;
  };
  depositTokenFunction?: {
    name: string;
    signature: string;
    agentIdParam: string;
  };
  network: {
    chainId: number;
    name: string;
    rpcUrl: string;
  };
}

interface PaymentMethodSelectorProps {
  paymentMethods: PaymentMethod[];
  supportedTokens: SupportedTokenInfo[];
  selectedMethod: PaymentMethod | null;
  selectedOption: TopUpOption | null;
  onMethodSelect: (method: PaymentMethod) => void;
  onOptionSelect: (option: TopUpOption) => void;
}

export function PaymentMethodSelector({
  paymentMethods,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  supportedTokens,
  selectedMethod,
  selectedOption,
  onMethodSelect,
  onOptionSelect,
}: PaymentMethodSelectorProps) {
  return (
    <div className="space-y-6">
      {/* Payment Method Selection */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Select Payment Method</h3>
        <div className="flex gap-3">
          {paymentMethods.map((method, index) => (
            <button
              key={index}
              onClick={() => onMethodSelect(method)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                selectedMethod?.type === method.type &&
                (method.type === 'eth' || selectedMethod?.token?.address === method.token?.address)
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-white/20 hover:border-white/40'
              }`}
            >
              {method.type === 'eth' ? (
                <>
                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                    <span className="text-white text-sm font-bold">Ξ</span>
                  </div>
                  <span className="text-white font-medium">ETH</span>
                </>
              ) : (
                <>
                  {method.token?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={method.token.logoUrl}
                      alt={method.token.symbol}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {method.token?.symbol?.slice(0, 2)}
                      </span>
                    </div>
                  )}
                  <span className="text-white font-medium">{method.token?.symbol}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Credit Package Selection */}
      {selectedMethod && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-3">Select Credits Package</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {selectedMethod.options.map((option, index) => (
              <button
                key={index}
                onClick={() => onOptionSelect(option)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  selectedOption === option
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/20 hover:border-white/40'
                }`}
              >
                <div className="text-xl font-bold text-white">
                  {option.creditsToTopUp} Credits
                </div>
                <div className="text-sm text-white/60 mt-1">
                  ${parseFloat(option.amountInUSD).toFixed(2)} USD
                </div>
                <div className="text-sm text-white/40 mt-1">
                  {selectedMethod.type === 'eth' ? (
                    <>≈ {parseFloat(option.amountInEth || '0').toFixed(6)} ETH</>
                  ) : (
                    <>≈ {option.amountInTokenHumanReadable} {selectedMethod.token?.symbol}</>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Approve Note for Tokens */}
      {selectedMethod?.type === 'token' && selectedMethod.contractFunction.approveRequired && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <p className="text-sm text-yellow-200">
            <strong>Note:</strong> Token payments require two transactions:
            <br />
            1. Approve the contract to spend your {selectedMethod.token?.symbol}
            <br />
            2. Complete the deposit
          </p>
        </div>
      )}
    </div>
  );
}

// Hook to fetch top-up details from API
export function useTopUpDetails(agentId: string, apiKey: string, baseUrl: string) {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [supportedTokens, setSupportedTokens] = useState<SupportedTokenInfo[]>([]);
  const [escrowContract, setEscrowContract] = useState<EscrowContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTopUpDetails = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(
          `${baseUrl}/api/top-up-details?agentId=${agentId}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch top-up details');
        }

        const data = await response.json();
        setPaymentMethods(data.paymentMethods || []);
        setSupportedTokens(data.supportedTokens || []);
        setEscrowContract(data.escrowContract || null);
        setError(null);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('Error fetching top-up details:', err);
      } finally {
        setIsLoading(false);
      }
    };

    if (agentId && apiKey) {
      fetchTopUpDetails();
    }
  }, [agentId, apiKey, baseUrl]);

  return {
    paymentMethods,
    supportedTokens,
    escrowContract,
    isLoading,
    error,
  };
}

export default PaymentMethodSelector;

