"use client"

import React, {
  createContext,
  useContext,
  useReducer,
} from "react"
import { useWallets } from "@/providers/wallet-provider"
import { Address, Hex, TransactionRequest } from "viem"

import { Transaction } from "@/types/web3"


type TransactionsState = {
  transactions: { [key: Address]: Transaction[] }
  loading: boolean
  error: string | null
}

type TransactionsAction =
  | {
    type: "SET_TRANSACTIONS"
    payload: { address: Address; transactions: Transaction[] }
  }
  | { type: "SET_FETCHING_TRANSACTIONS" }
  | { type: "SET_ERROR"; payload: string }
  | {
    type: "ADD_TRANSACTION"
    payload: { address: Address; transaction: Transaction }
  }

type TransactionsContextType = TransactionsState & {
  addPendingTransaction: (
    transaction: TransactionRequest & { hash: Hex }
  ) => void
}

const TransactionsContext = createContext<TransactionsContextType | undefined>(
  undefined
)

const initialState: TransactionsState = {
  transactions: {},
  loading: true,
  error: null,
}

function transactionsReducer(
  state: TransactionsState,
  action: TransactionsAction
): TransactionsState {
  switch (action.type) {
  case "SET_TRANSACTIONS":
    return {
      ...state,
      transactions: {
        ...state.transactions,
        [action.payload.address]: action.payload.transactions,
      },
      loading: false,
      error: null,
    }
  case "SET_FETCHING_TRANSACTIONS":
    return {
      ...state,
      loading: true,
      error: null,
    }
  case "SET_ERROR":
    return {
      ...state,
      loading: false,
      error: action.payload,
    }
  case "ADD_TRANSACTION":
    return {
      ...state,
      transactions: {
        ...state.transactions,
        [action.payload.address]: [
          action.payload.transaction,
          ...(state.transactions[action.payload.address] || []).filter(
            (tx) => tx.hash !== action.payload.transaction.hash
          ),
        ],
      },
    }
  default:
    return state
  }
}

export const TransactionsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    state: { selectedAccount },
  } = useWallets()
  const [state, dispatch] = useReducer(transactionsReducer, initialState)

  // useEffect(() => {
  //   const fetchTransactions = async () => {
  //     if (selectedAccount?.address) {
  //       dispatch({ type: "SET_FETCHING_TRANSACTIONS" })
  //       try {
  //         const transactions = await getTransactions(selectedAccount.address)

  //         dispatch({
  //           type: "SET_TRANSACTIONS",
  //           payload: {
  //             address: selectedAccount.address,
  //             transactions,
  //           },
  //         })

  //         // Unwatch previous listener if exists
  //         if (unwatchRef.current) {
  //           unwatchRef.current()
  //         }

  //         // Set up new listener
  //         unwatchRef.current = watchMinedTransactions(
  //           selectedAccount.address,
  //           (tx) => {
  //             dispatch({
  //               type: "ADD_TRANSACTION",
  //               payload: {
  //                 address: selectedAccount.address,
  //                 transaction: tx,
  //               },
  //             })
  //             selectAccount(selectedAccount)
  //           }
  //         )
  //       } catch (error: unknown) {
  //         console.error("Error fetching transactions:", error)
  //         const alchemyError = error as AlchemyError;
  //         // Handle specific Alchemy API errors
  //         if (alchemyError?.code === -32603) {
  //           dispatch({
  //             type: "SET_ERROR",
  //             payload: "Unable to fetch transactions at this time. Please try again later.",
  //           })
  //         } else {
  //           dispatch({
  //             type: "SET_ERROR",
  //             payload: "Failed to fetch transactions. Please check your connection and try again.",
  //           })
  //         }
  //         // Set empty transactions array to prevent UI from showing stale data
  //         dispatch({
  //           type: "SET_TRANSACTIONS",
  //           payload: {
  //             address: selectedAccount.address,
  //             transactions: [],
  //           },
  //         })
  //       }
  //     }
  //   }
  //   fetchTransactions()

  //   // Cleanup function to unwatch when component unmounts or selectedAccount changes
  //   return () => {
  //     if (unwatchRef.current) {
  //       unwatchRef.current()
  //     }
  //   }
  // }, [selectedAccount?.address])

  const addPendingTransaction = ({
    hash,
    value,
    from,
    to,
  }: TransactionRequest & { hash: Hex }) => {
    if (!selectedAccount?.address) return
    if (!from) return
    dispatch({
      type: "ADD_TRANSACTION",
      payload: {
        address: selectedAccount?.address,
        transaction: {
          hash,
          value: value ?? null,
          from,
          to: to ?? null,
          status: "pending",
          blockNumber: null,
          timestamp: new Date().toISOString(),
        },
      },
    })
  }

  return (
    <TransactionsContext.Provider value={{ ...state, addPendingTransaction }}>
      {children}
    </TransactionsContext.Provider>
  )
}

export const useTransactions = () => {
  const context = useContext(TransactionsContext)
  if (!context) {
    throw new Error(
      "useTransactions must be used within a TransactionsProvider"
    )
  }
  return context
}
