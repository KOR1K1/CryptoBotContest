/**
 * Ledger entry types for financial audit trail
 * All balance operations MUST create a ledger entry
 */
export enum LedgerType {
  DEPOSIT = 'DEPOSIT', // Funds deposited (initial balance, external deposit)
  LOCK = 'LOCK', // Funds locked for bid
  UNLOCK = 'UNLOCK', // Funds unlocked (rare, for edge cases)
  PAYOUT = 'PAYOUT', // Funds paid out to winner
  REFUND = 'REFUND', // Funds refunded after auction end
}

