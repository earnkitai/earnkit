"use client"

import { useEffect, useState } from "react"
import { Loader, CheckCircle2, XCircle, ExternalLink } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog"
import { cn } from "@/lib/utils"

interface TransactionStatusProps {
    isOpen: boolean
    onClose: () => void
    title: string
    description: string
    type: "loading" | "success" | "error"
    hash?: string
}

export function TransactionStatus({
    isOpen,
    onClose,
    title,
    description,
    type,
    hash,
}: TransactionStatusProps) {
    const [showDialog, setShowDialog] = useState(isOpen)
    const [progress, setProgress] = useState(0)

    useEffect(() => {
        setShowDialog(isOpen)
    }, [isOpen])

    // Simulate progress for loading state
    useEffect(() => {
        if (type === "loading" && showDialog) {
            const interval = setInterval(() => {
                setProgress((prev) => {
                    if (prev >= 90) return prev
                    return prev + 10
                })
            }, 500)
            return () => clearInterval(interval)
        }
    }, [type, showDialog])

    const handleClose = () => {
        setShowDialog(false)
        setProgress(0)
        onClose()
    }

    // Auto-close success messages after 5 seconds
    useEffect(() => {
        if (type === "success" && showDialog) {
            const timer = setTimeout(() => {
                handleClose()
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [type, showDialog])

    return (
        <Dialog open={showDialog} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[425px] p-6">
                <DialogHeader className="space-y-4">
                    <div className="flex items-center justify-center">
                        <div className={cn(
                            "w-16 h-16 rounded-full flex items-center justify-center",
                            type === "loading" && "bg-blue-50",
                            type === "success" && "bg-green-50",
                            type === "error" && "bg-red-50"
                        )}>
                            {type === "loading" && (
                                <Loader className="h-8 w-8 animate-spin text-blue-500" />
                            )}
                            {type === "success" && (
                                <CheckCircle2 className="h-8 w-8 text-green-500" />
                            )}
                            {type === "error" && (
                                <XCircle className="h-8 w-8 text-red-500" />
                            )}
                        </div>
                    </div>
                    <DialogTitle className="text-center text-xl font-semibold">
                        {title}
                    </DialogTitle>
                    <DialogDescription className="text-center text-gray-600">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {type === "loading" && (
                    <div className="mt-4 space-y-2">
                        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-in-out"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="text-sm text-gray-500 text-center">
                            Processing transaction...
                        </p>
                    </div>
                )}

                {hash && (
                    <div className="mt-4 flex items-center justify-center">
                        <a
                            href={`https://basescan.org/tx/${hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm text-blue-500 hover:text-blue-600 transition-colors"
                        >
                            View on BaseScan
                            <ExternalLink className="h-4 w-4" />
                        </a>
                    </div>
                )}

                {type === "error" && (
                    <div className="mt-4">
                        <button
                            onClick={handleClose}
                            className="w-full py-2 px-4 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
                        >
                            Close
                        </button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
} 