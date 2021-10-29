import { Currency } from '@marginswap/sdk'
import TransactionConfirmationModal, {
  ConfirmationModalContent,
  TransactionErrorContent
} from 'components/TransactionConfirmationModal'
import React, { useCallback } from 'react'
import OrderModalFooter from './OrderModalFooter'
import OrderModalHeader from './OrderModalHeader'

export default function ConfirmSwapModal({
  onConfirm,
  onDismiss,
  attemptingTxn,
  orderErrorMessage,
  isOpen,
  fromToken,
  toToken,
  inAmount,
  outAmount,
  orderTxHash,
  cancelling
}: {
  isOpen: boolean
  onConfirm: () => void
  attemptingTxn: boolean
  orderErrorMessage: string | undefined
  onDismiss: () => void
  fromToken: Currency
  toToken: Currency
  inAmount: string
  outAmount: string
  orderTxHash: string | undefined
  cancelling?: boolean
}) {
  const modalHeader = useCallback(() => {
    return <OrderModalHeader fromToken={fromToken} toToken={toToken} inAmount={inAmount} outAmount={outAmount} />
  }, [fromToken, toToken, inAmount, outAmount])

  const modalBottom = useCallback(() => {
    return <OrderModalFooter onConfirm={onConfirm} orderErrorMessage={orderErrorMessage} />
  }, [onConfirm, fromToken, toToken, inAmount, outAmount])

  // text to show while loading
  const pendingText = !cancelling
    ? `Making an order of ${inAmount} ${fromToken.symbol} for ${outAmount} ${toToken.symbol}`
    : 'Cancelling the order'

  const confirmationContent = useCallback(
    () =>
      orderErrorMessage ? (
        <TransactionErrorContent onDismiss={onDismiss} message={orderErrorMessage} />
      ) : (
        <ConfirmationModalContent
          title={!cancelling ? 'Confirm Order' : 'Cancel Order'}
          onDismiss={onDismiss}
          topContent={modalHeader}
          bottomContent={modalBottom}
        />
      ),
    [onDismiss, modalBottom, modalHeader, orderErrorMessage]
  )

  return (
    <TransactionConfirmationModal
      isOpen={isOpen}
      onDismiss={onDismiss}
      attemptingTxn={attemptingTxn}
      hash={orderTxHash}
      content={confirmationContent}
      pendingText={pendingText}
    />
  )
}
