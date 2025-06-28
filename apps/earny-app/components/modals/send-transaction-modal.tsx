import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrivy, useWallets } from '@privy-io/react-auth';

import { parseEther, formatEther } from 'viem';
import { toast } from 'sonner';
import { getBalance } from '@/actions/web3';
import { useTokenPrice } from '@/hooks/use-token-price';
import { base } from 'viem/chains';
// import { X } from 'lucide-react';

interface SendTransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SendTransactionModal({ isOpen, onClose }: SendTransactionModalProps) {
    const [amount, setAmount] = useState<string>('');
    const [recipient, setRecipient] = useState<string>('');
    const [usdValue, setUsdValue] = useState<string>('0.00');
    const [isLoading, setIsLoading] = useState(false);
    const [balance, setBalance] = useState<string>('0');
    const { wallets, ready } = useWallets();
    const { ethPrice } = useTokenPrice()
    const activeWallet = ready && wallets[0] || null;

    useEffect(() => {
        console.log("inside the send transaction modal")
    }, [])

    const { sendTransaction } = usePrivy();

    // Update USD value when ETH amount changes
    useEffect(() => {
        if (amount && !isNaN(Number(amount))) {
            const usdAmount = (Number(amount) * (ethPrice || 0)).toFixed(2);
            setUsdValue(usdAmount);
        } else {
            setUsdValue('0.00');
        }
    }, [amount, ethPrice]);

    useEffect(() => {
        const fetchBalance = async () => {
            if (activeWallet) {
                const balance = await getBalance(
                    activeWallet.address as `0x${string}`,
                    "base"
                );

                const ethBalanceFormatted = balance
                    ? parseFloat(Number(formatEther(balance)).toFixed(8))
                    : 0
                setBalance(ethBalanceFormatted.toString());
            }
        }
        fetchBalance();
    }, [activeWallet]);

    const handleSendTransaction = async () => {
        if (!activeWallet || !amount || !recipient) {
            toast.error('Please fill in all fields');
            return;
        }

        try {
            setIsLoading(true);

            // Validate recipient address
            if (!recipient.startsWith('0x') || recipient.length !== 42) {
                toast.error('Invalid recipient address');
                return;
            }

            // Convert ETH to Wei
            const valueInWei = parseEther(amount);

            const transactionRequest = {
                to: recipient,
                chainId: base.id,
                value: valueInWei.toString()
            };

            const { hash } = await sendTransaction(transactionRequest);
            toast.success(`Transaction sent successfully! ${hash}`);

            toast.success('Transaction sent successfully!');
            onClose();

        } catch (error) {
            console.error('Transaction failed:', error);
            toast.error('Transaction failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px] bg-black border border-white/10 rounded-[56px] p-0 overflow-hidden">
                <DialogHeader className="bg-color2 p-8 pb-6">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-3xl font-bold font-funnel-display text-white">
                            Send ETH
                        </DialogTitle>
                        {/* <button
                            onClick={onClose}
                            className="text-white/60 hover:text-white transition-colors"
                        >
                            <X className="w-6 h-6" />
                        </button> */}
                    </div>
                </DialogHeader>

                <div className="p-8 pt-6 space-y-6">
                    <div className="space-y-3">
                        <Label htmlFor="recipient" className="text-white/80 font-funnel-sans text-sm font-medium">
                            Recipient Address
                        </Label>
                        <Input
                            id="recipient"
                            placeholder="0x..."
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            className="font-mono bg-white/5 border-white/20 text-white placeholder:text-white/40 rounded-full px-4 py-3 h-12 focus:border-color6 focus:ring-color6/20"
                        />
                    </div>

                    <div className="space-y-3">
                        <Label htmlFor="amount" className="text-white/80 font-funnel-sans text-sm font-medium">
                            Amount
                        </Label>
                        <div className="relative">
                            <Input
                                id="amount"
                                type="number"
                                placeholder="0.0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="pr-16 bg-white/5 border-white/20 text-white placeholder:text-white/40 rounded-full px-4 py-3 h-12 focus:border-color6 focus:ring-color6/20"
                                step="0.0001"
                                min="0"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 font-funnel-sans text-sm">
                                ETH
                            </span>
                        </div>
                        <p className="text-sm text-white/40 font-funnel-sans">
                            ≈ ${usdValue} USD
                        </p>
                    </div>

                    {activeWallet && (
                        <div className="bg-white/5 rounded-full px-4 py-3 border border-white/10">
                            <p className="text-sm text-white/60 font-funnel-sans">
                                Balance: <span className="text-white font-medium">{balance} ETH</span>
                            </p>
                        </div>
                    )}

                    <Button
                        onClick={handleSendTransaction}
                        disabled={isLoading || !amount || !recipient}
                        className="w-full bg-color2 hover:bg-color3 text-white font-funnel-display font-semibold text-lg rounded-full py-4 h-14 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Sending...' : 'Send ETH'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
} 