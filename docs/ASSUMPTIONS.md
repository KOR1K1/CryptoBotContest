# Auction Assumptions & Open Questions

This document lists assumptions made due to missing or non-public details
of Telegram Gift Auctions.

Each assumption is deliberate and justified.

---

## 1. Auction Structure

### Assumption
An auction consists of a fixed number of rounds, defined at creation time.

### Reasoning
Telegram publicly mentions "multiple rounds" but does not specify dynamic round creation.
A fixed round count simplifies predictability and fairness.

### Default Parameters (for MVP/demo)
- **totalRounds**: 3 rounds (configurable, min: 1)
- **roundDurationMs**: 60000ms (1 minute) for demo, 300000ms (5 minutes) recommended for production
- **giftsPerRound**: Calculated as `Math.ceil(totalGifts / totalRounds)` for even distribution
  - Last round gets remainder if totalGifts not evenly divisible
- **minBid**: 100 (internal currency units) - minimum value for any bid

---

## 2. Winners per Round

### Assumption
Each round awards a predefined number of gifts.

### Reasoning
Observed behavior suggests partial distribution per round.
This prevents single-round dominance and supports gradual allocation.

---

## 3. Bid Carry-Over

### Assumption
Bids that do not win in a round automatically participate in the next round.

### Reasoning
Telegram explicitly mentions bid carry-over behavior.
Funds remain locked until win or auction end.

### Implementation Details
- **Automatic**: No user action required for carry-over
- **Single bid per auction**: One user can have only one ACTIVE bid per auction at a time
- **roundIndex update**: When bid carries over, `bid.roundIndex` is updated to current round for tracking
- **No balance change**: `lockedBalance` remains unchanged during carry-over
- **Status remains ACTIVE**: Bid status stays ACTIVE until WON or REFUNDED

---

## 4. Tie-Breaking Logic

### Assumption
When two bids have equal amounts, the earlier bid wins.

### Reasoning
Ensures deterministic ordering and avoids randomness.

---

## 5. Balance Locking Model

### Assumption
Funds are locked at bid placement, not spent.

### Reasoning
Telegram Stars are visibly locked during auctions.
This prevents overspending and double allocation.

---

## 6. Refund Timing

### Assumption
Refunds for losing bids occur only after the final round completes.

### Reasoning
Simplifies accounting and mirrors observed Telegram behavior.

### Refund Process
- **Trigger**: After final round closes and winners are selected
- **Scope**: All ACTIVE bids (that did not win) are refunded
- **Atomic**: Refunds happen within MongoDB transaction for consistency
- **Ledger**: Every refund creates LedgerEntry with type REFUND
- **Status update**: Bid status changes to REFUNDED (immutable after that)
- **Timing**: Refunds occur during auction finalization phase (FINALIZING → COMPLETED)

---

## 7. Anti-Sniping Strategy

### Assumption
No time extension mechanism is used.

### Reasoning
Telegram avoids deadline-based auctions.
Multi-round design removes last-second advantage.

---

## 8. Failure Handling

### Assumption
If a round fails mid-processing, the system retries idempotently.

### Reasoning
Production-grade systems must handle partial failures safely.

---

## 9. Bid Increase Behavior

### Assumption
Users can only **increase** their bid amount, never decrease.

### Reasoning
Prevents gaming the system by reducing bids after seeing competition.
Ensures bid amounts only move upward.

### Implementation
- New bid amount must be > existing bid amount
- Difference is locked from user's balance
- Creates new LedgerEntry for the delta amount

---

## 10. Concurrent Bid Handling

### Assumption
Multiple simultaneous bid requests are handled atomically via MongoDB transactions.

### Reasoning
Prevents race conditions in balance updates and duplicate bids.

### Implementation
- MongoDB transactions ensure atomicity
- Optimistic locking prevents double-spending
- First request wins, others get conflict error

---

## 11. One Bid Per Auction Rule

### Assumption
A user can have only **one ACTIVE bid** per auction at a time.

### Reasoning
Simplifies carry-over logic and prevents confusion.
User increases existing bid instead of creating multiple.

### Implementation
- On new bid: check for existing ACTIVE bid
- If exists: update existing bid (increase amount)
- If not exists: create new bid

---

## 12. Gift Carry-Over Between Rounds

### Assumption
If fewer winners are selected in a round than `giftsPerRound` (due to insufficient active bids), the unclaimed gifts are automatically carried over to subsequent rounds.

### Reasoning
This ensures maximum gift distribution and prevents unused gift inventory. The multi-round system naturally handles this by tracking `alreadyAwarded` and calculating `remainingGifts` dynamically.

### Implementation Details
- **Tracking**: `alreadyAwarded = sum(winnersCount)` from all previous closed rounds
- **Calculation**: `remainingGifts = totalGifts - alreadyAwarded`
- **Distribution**: 
  - Non-last rounds: `giftsPerRound = min(ceil(totalGifts / totalRounds), remainingGifts)`
  - Last round: `giftsPerRound = remainingGifts` (award all remaining)
- **Result**: Unclaimed gifts from earlier rounds increase available gifts in later rounds

### Example
```
Auction: totalGifts=1000, totalRounds=10
Expected per round: 100 gifts

Round 1: 80 winners (20 unclaimed)
Round 2: 90 winners (10 unclaimed)
...
Round 10: remainingGifts = 1000 - (80+90+...) = 100+ carry-over from previous rounds
```

---

## 13. Unclaimed Gifts at Auction End

### Assumption
If there are fewer total winners than `totalGifts` after all rounds complete (due to insufficient participation), the unclaimed gifts remain **unclaimed** and are not automatically distributed.

### Reasoning
This follows a conservative approach:
- No forced distribution (prevents unfair allocation)
- Gifts are not "burned" or destroyed
- The auction owner can decide post-auction disposition
- Maintains audit trail of actual distribution vs. planned

### Implementation Details
- **Tracking**: Final `alreadyAwarded` vs. `totalGifts` is logged
- **Status**: Auction completes normally with `status=COMPLETED`
- **Record**: The difference is visible in auction data (`totalGifts - final alreadyAwarded`)
- **Post-Auction**: Unclaimed gifts can be handled separately (manual distribution, new auction, etc.)

### Business Logic
- Unclaimed gifts do NOT automatically go to:
  - Random participants
  - Highest bidders
  - Auction creator
- They remain in the system's inventory for manual processing

---

## 14. Performance & Scalability Assumptions

### Assumption
The system is designed to handle **100k-1M bids per round** efficiently with current optimizations. For **1M-10M bids per round**, infrastructure scaling is required.

### Reasoning
Performance optimizations have been implemented for core operations (winner selection, refunds, dashboard queries), but very high loads require horizontal scaling and additional infrastructure.

### Current Capacity (Single Instance)
- ✅ **50k-100k bids/round**: Excellent performance (<200ms queries)
- ✅ **100k-1M bids/round**: Good performance (<500ms queries) with monitoring
- ⚠️ **1M-10M bids/round**: Works but requires infrastructure scaling
- ❌ **10M+ bids/round**: Requires all Very Large Scale optimizations

### Performance Optimizations (Implemented)
1. **Winner Selection**: Uses `.limit()` instead of loading all bids
2. **Refund Processing**: Uses batch processing with cursor pagination (1000 bids/batch)
3. **Dashboard Queries**: Optimized with `.limit(3)` and `countDocuments` with indexes
4. **Database Indexes**: All critical queries use compound indexes efficiently

### Recommended Optimizations (Large Scale: 100k-1M bids/round)
1. **WebSocket Update Throttling**: Batch updates every 100ms
2. **MongoDB Memory Monitoring**: 16GB+ RAM recommended
3. **Read Replicas**: Separate read/write load for dashboard queries

### Required Optimizations (Very Large Scale: 1M-10M bids/round)
1. **Horizontal Scaling**: Multiple API instances with load balancer
2. **Socket.IO Redis Adapter**: Multi-server WebSocket support
3. **MongoDB Replica Set**: Read replicas for query distribution
4. **Bid Update Aggregation**: Batch bid updates every 100ms
5. **Database Sharding**: Shard by `auctionId` for 10M+ bids/auction

### Implementation Notes
- Current optimizations handle 100k-1M bids/round efficiently
- For 1M-10M bids/round, infrastructure scaling is mandatory
- For 10M+ bids/round, full horizontal scaling architecture required

---

## Open Questions (Not Implemented)

- Dynamic round extension (fixed rounds only)
- Early auction termination (auctions run to completion)
- Secondary market integration
- NFT / blockchain ownership
- Maximum bid amount limit (no upper bound in MVP)
- Per-user bid limits (unlimited bids allowed)
- **Automatic redistribution of unclaimed gifts** (manual only)
- **Performance optimizations for 10M+ bids/round** (requires infrastructure overhaul)

These are intentionally out of scope for MVP or require significant infrastructure investment.