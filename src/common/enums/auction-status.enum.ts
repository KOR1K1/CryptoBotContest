/**
 * Auction lifecycle states
 * State machine: CREATED -> RUNNING -> FINALIZING -> COMPLETED
 */
export enum AuctionStatus {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  FINALIZING = 'FINALIZING',
  COMPLETED = 'COMPLETED',
}

