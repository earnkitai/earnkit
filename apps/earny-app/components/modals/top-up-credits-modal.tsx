'use client';

import { useState, useEffect } from 'react';
import { useWallets, usePrivy } from '@privy-io/react-auth';
import { createWalletClient, createPublicClient, custom, http, erc20Abi, keccak256, encodePacked } from 'viem';
import { base } from 'viem/chains';

// Public client for waiting for transaction confirmations
const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/components/ui/dialog';
import { Button } from '@/app/components/ui/button';
import { PaymentMethodSelector, useTopUpDetails } from '@/app/components/dashboard/PaymentMethodSelector';
import { toast } from 'sonner';

// Types for payment methods
interface TopUpOption {
  label: string;
  amountInUSD: string;
  amountInEth?: string;
  value?: string;
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

// EarnKitEscrow ABI (minimal for deposit functions)
const ESCROW_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'depositToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'bytes32' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

interface TopUpCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  apiKey: string;
  apiBaseUrl: string;
  onSuccess?: (txHash: string) => void;
}

export function TopUpCreditsModal({
  isOpen,
  onClose,
  agentId,
  apiKey,
  apiBaseUrl,
  onSuccess,
}: TopUpCreditsModalProps) {
  const { wallets, ready: walletsReady } = useWallets();
  const { login, authenticated, ready: privyReady } = usePrivy();
  const activeWallet = wallets[0];
  
  const {
    paymentMethods,
    supportedTokens,
    escrowContract,
    isLoading,
    error,
  } = useTopUpDetails(agentId, apiKey, apiBaseUrl);

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [selectedOption, setSelectedOption] = useState<TopUpOption | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'select' | 'approve' | 'deposit'>('select');

  // Prefer ETH when available, otherwise fall back to the first enabled method.
  useEffect(() => {
    if (paymentMethods.length > 0 && !selectedMethod) {
      const defaultMethod =
        paymentMethods.find((m) => m.type === 'eth') ?? paymentMethods[0];

      if (defaultMethod) {
        setSelectedMethod(defaultMethod);
      }
    }
  }, [paymentMethods, selectedMethod]);

  const handleMethodSelect = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setSelectedOption(null);
    setStep('select');
  };

  const handleOptionSelect = (option: TopUpOption) => {
    setSelectedOption(option);
  };

  // Convert agentId string to bytes32 using keccak256 hash
  const agentIdToBytes32 = (id: string): `0x${string}` => {
    // Hash the agentId string to get a proper bytes32
    return keccak256(encodePacked(['string'], [id]));
  };

  const handleDeposit = async () => {
    if (!activeWallet || !selectedOption || !escrowContract || !selectedMethod) {
      toast.error('Please connect wallet and select an option');
      return;
    }

    try {
      setIsProcessing(true);
      const provider = await activeWallet.getEthereumProvider();
      const walletClient = createWalletClient({
        chain: base,
        transport: custom(provider),
      });

      const agentIdBytes32 = agentIdToBytes32(agentId);

      if (selectedMethod.type === 'eth') {
        // ETH deposit
        setStep('deposit');
        const txHash = await walletClient.writeContract({
          address: escrowContract.address as `0x${string}`,
          abi: ESCROW_ABI,
          functionName: 'deposit',
          args: [agentIdBytes32],
          value: BigInt(selectedOption.value || '0'),
          account: activeWallet.address as `0x${string}`,
        });

        toast.success('Deposit successful!');
        onSuccess?.(txHash);
        
        // Submit to backend for tracking
        await submitTopUpTransaction(txHash, 'eth');
        
        onClose();
      } else {
        // Token deposit
        if (!selectedMethod.token) {
          toast.error('Token not configured');
          return;
        }
        const tokenAddress = selectedMethod.token.address as `0x${string}`;
        const amount = BigInt(selectedOption.amountInToken || '0');
        const isSplitsMode = escrowContract.depositFunction.name === 'send';

        if (isSplitsMode) {
          // Splits mode: direct ERC-20 transfer to split address, no approve step
          setStep('deposit');
          toast.info('Transferring tokens...');

          const txHash = await walletClient.writeContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [escrowContract.address as `0x${string}`, amount],
            account: activeWallet.address as `0x${string}`,
          });

          toast.success('Deposit successful!');
          onSuccess?.(txHash);
          await submitTopUpTransaction(txHash, 'token');
          onClose();
        } else {
          // Escrow mode: approve + depositToken
          setStep('approve');
          toast.info('Step 1/2: Approving token spend...');

          const approveTx = await walletClient.writeContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [escrowContract.address as `0x${string}`, amount],
            account: activeWallet.address as `0x${string}`,
          });

          toast.info('Waiting for approval confirmation...');
          await publicClient.waitForTransactionReceipt({
            hash: approveTx,
            confirmations: 1,
          });

          toast.success('Approval confirmed! Now depositing...');

          setStep('deposit');
          toast.info('Step 2/2: Depositing tokens...');

          const depositTx = await walletClient.writeContract({
            address: escrowContract.address as `0x${string}`,
            abi: ESCROW_ABI,
            functionName: 'depositToken',
            args: [agentIdBytes32, tokenAddress, amount],
            account: activeWallet.address as `0x${string}`,
          });

          toast.success('Deposit successful!');
          onSuccess?.(depositTx);
          await submitTopUpTransaction(depositTx, 'token');
          onClose();
        }
      }
    } catch (err: unknown) {
      console.error('Transaction error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
      setStep('select');
    }
  };

  const submitTopUpTransaction = async (txHash: string, type: 'eth' | 'token') => {
    try {
      await fetch(`${apiBaseUrl}/api/top-up-details`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          agentId,
          txHash,
          walletAddress: activeWallet?.address,
          amountInUSD: selectedOption?.amountInUSD || '0',
          amountInEth: selectedOption?.amountInEth || '0',
          creditsToTopUp: selectedOption?.creditsToTopUp,
          ...(type === 'token' && selectedMethod?.token && {
            tokenAddress: selectedMethod.token.address,
            tokenSymbol: selectedMethod.token.symbol,
            amountInToken: selectedOption?.amountInToken,
          }),
        }),
      });
    } catch (err) {
      console.error('Failed to submit transaction to backend:', err);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1a1a1a] border-white/10 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">Top Up Credits</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {!privyReady || !walletsReady ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          ) : !authenticated ? (
            <div className="text-center py-8">
              <p className="text-white/60 mb-4">Please log in to top up credits</p>
              <Button
                onClick={() => login()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6"
              >
                Log In / Sign Up
              </Button>
            </div>
          ) : !activeWallet ? (
            <div className="text-center py-8">
              <p className="text-white/60 mb-4">No wallet connected. Please connect a wallet.</p>
              <p className="text-white/40 text-sm">Go to settings to connect your wallet.</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          ) : error ? (
            <div className="text-red-400 text-center py-4">{error}</div>
          ) : (
            <PaymentMethodSelector
              paymentMethods={paymentMethods}
              supportedTokens={supportedTokens}
              selectedMethod={selectedMethod}
              selectedOption={selectedOption}
              onMethodSelect={handleMethodSelect}
              onOptionSelect={handleOptionSelect}
            />
          )}
        </div>

        <div className="flex gap-3 pt-4 border-t border-white/10">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-white/20 text-white hover:bg-white/10"
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeposit}
            disabled={!activeWallet || !selectedOption || isProcessing || isLoading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isProcessing ? (
              <>
                {step === 'approve' && 'Approving...'}
                {step === 'deposit' && 'Depositing...'}
              </>
            ) : (
              `Pay ${selectedOption ? `$${parseFloat(selectedOption.amountInUSD).toFixed(2)}` : ''}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TopUpCreditsModal;

