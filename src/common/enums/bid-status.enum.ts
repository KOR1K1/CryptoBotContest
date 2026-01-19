/**
 * Bid status lifecycle
 * ACTIVE -> (WON | REFUNDED)
 * Bid remains ACTIVE between rounds until it wins or auction ends
 */
export enum BidStatus {
  ACTIVE = 'ACTIVE',
  WON = 'WON',
  REFUNDED = 'REFUNDED',
}

