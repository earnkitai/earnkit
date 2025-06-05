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
    // const { sendTransaction } = useSendTransaction();

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
        // console.log(activeWallet);
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
                // console.log(balance);
            }
        }
        fetchBalance();
    }, [activeWallet]);

    const handleSendTransaction = async () => {
        if (!activeWallet || !amount || !recipient) {
            toast.error('Please fill in all fields');
            return;
        }

        // console.log(activeWallet, 'activeWallet')

        try {
            setIsLoading(true);

            // Validate recipient address
            if (!recipient.startsWith('0x') || recipient.length !== 42) {
                toast.error('Invalid recipient address');
                return;
            }

            // Convert ETH to Wei
            const valueInWei = parseEther(amount);

            // const provider = await activeWallet.getEthereumProvider();

            const transactionRequest = {
                to: recipient,
                chainId: base.id,
                value: valueInWei.toString()
            };
            // const transactionHash = await provider.request({
            //     method: 'eth_sendTransaction',
            //     params: [transactionRequest]
            // });
            // console.log(transactionHash);

            // const uiOptions = {
            //     title: 'You are voting for foobar project'
            // };

            // const { signature } = await signMessage({ message: 'I hereby vote for foobar' }, { uiOptions });

            // console.log(signature);
            // const txHash = await signTransaction({
            //     to: recipient,
            //     value: valueInWei.toString(),
            // });
            // Send transaction



            // const txHash = await sendTransaction({
            //     to: recipient,
            //     value: valueInWei.toString(),
            // });
            // console.log('Transaction hash:', txHash);


            const { hash } = await sendTransaction(transactionRequest);
            toast.success(`Transaction sent successfully! ${hash}`);
            // console.log(hash, 'transactionHash')

            // const txHash = await sendTransactionWithoutApproval(
            //     activeWallet.id,
            //     recipient as `0x${string}`,
            //     amount
            // );
            // console.log('Transaction hash:', txHash);


            toast.success('Transaction sent successfully!');
            onClose();

        } catch (error) {
            console.error('Transaction failed:', error);
            toast.error('Transaction failed. Please try again.');
        } finally {
            // setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold">Send ETH</DialogTitle>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="recipient">Recipient Address</Label>
                        <Input
                            id="recipient"
                            placeholder="0x..."
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            className="font-mono"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="amount">Amount</Label>
                        <div className="relative">
                            <Input
                                id="amount"
                                type="number"
                                placeholder="0.0"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="pr-12"
                                step="0.0001"
                                min="0"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                                ETH
                            </span>
                        </div>
                        <p className="text-sm text-gray-500">
                            ≈ ${usdValue} USD
                        </p>
                    </div>

                    {activeWallet && (
                        <div className="text-sm text-gray-500">
                            Balance: {balance} ETH
                        </div>
                    )}

                    <Button
                        onClick={handleSendTransaction}
                        disabled={isLoading || !amount || !recipient}
                        className="w-full"
                    >
                        {isLoading ? 'Sending...' : 'Send ETH'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
} 