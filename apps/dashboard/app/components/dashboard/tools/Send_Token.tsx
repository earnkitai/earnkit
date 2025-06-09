import { useEffect, useState } from 'react';
import { showTransactionToast } from '@/lib/toast';
import { getPublicClient } from '@/lib/web3';
import { Icons } from '@/app/components/sections/icons';
import Image from 'next/image';
import Link from 'next/link';
import { CopyIcon } from 'lucide-react';
import { useSendTransaction } from '@privy-io/react-auth';
import { truncateAddress } from '@/lib/utils';
import { toast } from 'sonner';
import { LoadingButton } from '../../ui/button.loader';
import { encodeFunctionData, erc20Abi } from 'viem';

interface Token {
    address: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
    image: string;
    currentPrice: number;
}

interface SendTokenResponse {
    token: Token;
    amount: string;
    originalAmount: string;
    amountType: string;
    recipient: `0x${string}`;
    sender: `0x${string}`;
    isNativeToken: boolean;
    transactionHash?: `0x${string}`;
}

interface SendTokenProps {
    data: SendTokenResponse;
    userAddress: `0x${string}`;
    onDeny: () => void;
    updateMessage: (messageId: string, content: string, metadata?: object) => Promise<{ id: string } | null>;
    messageId?: string;
}

export default function SendToken({ data, userAddress, onDeny, updateMessage, messageId }: SendTokenProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(null);
    const { sendTransaction } = useSendTransaction();
    useEffect(() => {
        if (data) {
            console.log(data, "data")
            if (data.transactionHash) {
                setTransactionHash(data.transactionHash);
            }
        }
    }, [data])

    const handleSend = async () => {
        setIsLoading(true);
        try {
            const publicClient = getPublicClient('base');
            console.log(data, "data")
            console.log({
                to: data.recipient,
                value: BigInt(data.amount),
            })
            console.log(userAddress, "userAddress")

            const recipientAddress = data.recipient;

            const encodedData = encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [recipientAddress, BigInt(data.amount)]
            });

            const { hash } = await sendTransaction({
                to: data.token.address,
                data: encodedData, // from the previous step
                chainId: 8453, // Base's chainId
            }, {
                address: userAddress
            });

            setTransactionHash(hash);
            const toastId = showTransactionToast({
                hash,
                title: 'Sending ETH...',
                description: 'Please wait for the transaction to complete',
                type: 'loading',
            });

            await publicClient.waitForTransactionReceipt({ hash });
            showTransactionToast({
                id: toastId,
                hash,
                title: 'ETH sent successfully! 🎉',
                description: 'Your ETH has been transferred',
                type: 'success',
            });

            // Update message with transaction hash
            if (messageId) {
                await updateMessage(messageId, JSON.stringify({
                    ...data,
                    transactionHash: hash
                }), { transactionHash: hash });
            }

        } catch (error) {
            console.error('Error sending token:', error);
            showTransactionToast({
                title: 'Error sending token',
                description: 'Please try again',
                type: 'error',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopyAddress = (address: `0x${string}`) => {
        navigator.clipboard.writeText(address);
        toast.success('Address copied to clipboard');
    }

    return (
        <div className="bg-white rounded-lg font-funnel-sans py-2 px-2 max-w-[500px] w-full">
            <p className="text-md font-medium text-black/80 mb-2">Here is your transaction</p>
            <div className="space-y-4">
                <p className="font-normal text-gray-500">Token</p>
                <div className="flex items-center gap-3 p-3 border border-black/10 rounded-lg">
                    <div className="relative flex items-center justify-center rounded-full border">
                        <Image
                            src={data.token.image}
                            alt={data.token.symbol}
                            width={32}
                            height={32}
                            className="rounded-full"
                        />
                        <Icons.baseIcon className="w-3 h-3 absolute -bottom-0.5 -right-0.5" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-black/80">{data.token.name}</p>
                        <p className="text-sm text-black/40">{data.token.symbol}</p>
                    </div>
                    <div className="text-right">
                        <p className="font-medium text-black/80">{data.originalAmount}</p>
                        <p className="text-sm text-black/40">
                            ${(parseFloat(data.originalAmount) * data.token.currentPrice).toFixed(2)}
                        </p>
                    </div>
                </div>
                <p className="font-normal text-gray-500">Recipient Address</p>
                <div className="rounded-lg">
                    <div className="flex items-center gap-3">
                        <p className="font-mono text-sm text-black/80 break-all">{truncateAddress(data.recipient, { prefix: 4, suffix: 4 })}</p>
                        <button className="text-black/40 hover:text-black/60 transition-colors" onClick={() => handleCopyAddress(data.recipient)}>
                            <CopyIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {transactionHash ? (
                    <div className="rounded-lg py-2 text-left">
                        <p className="text-green-600 mb-4">Token sent successfully! 🎉</p>
                        <Link
                            href={`https://basescan.org/tx/${transactionHash}`}
                            target="_blank"
                            className="text-secondary-blue text-sm font-semibold flex items-center justify-start gap-1 font-funnel-sans bg-transparent border border-black/20 rounded-full px-3 py-0.5 w-fit"
                        >
                            View on Explorer
                            <Icons.arrowUpBlueIcon />
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="font-normal text-gray-500">Ready to proceed?</p>
                        <div className="flex gap-4">
                            <LoadingButton
                                onClick={handleSend}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-secondary-green hover:bg-green-600 font-funnel-sans text-white rounded-full transition-colors"
                                loading={isLoading}
                            >
                                Confirm
                            </LoadingButton>

                            <button
                                className="px-4 py-2 bg-secondary-red text-white rounded-full hover:bg-red-600 transition-colors"
                                onClick={onDeny}
                            >
                                Deny
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
