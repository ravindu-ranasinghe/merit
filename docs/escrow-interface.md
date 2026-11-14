# BountyEscrow interface (owner: Engineer A)

Machine-readable ABI: [`docs/escrow-abi.json`](./escrow-abi.json) (regenerate with `make -C contracts abi`).
Source: [`contracts/src/BountyEscrow.sol`](../contracts/src/BountyEscrow.sol).

| | |
|---|---|
| Chain | Arc testnet, chain ID `5042002` |
| RPC | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| **BountyEscrow address** | **not deployed yet** — this line is updated in the deploy PR |
| Deploy block | — (Streams filter start block) |

The frozen surface in `SPEC.md` is implemented **unchanged**: same four functions, same
argument order, same four events.

## Units

Every amount is an integer in USDC base units (6 decimals). No floats anywhere.

| Human | `amount` |
|---|---|
| $0.000001 | `1` |
| $1.00 | `1000000` |
| **$10.00** | **`10000000`** |
| $12.34 | `12340000` |

Worked $10 bounty: maintainer calls `USDC.approve(escrow, 10000000)`, then
`createBounty(prHash, 10000000, expiry)`. Escrow USDC balance rises by `10000000`.
Maintainer approves `approveReward(id, reviewer, 10000000, claimId)`; reviewer calls
`claim(id)` and receives exactly `10000000`. If instead only `4000000` ($4) is approved,
after expiry `refundExpired(id)` returns `6000000` ($6) to the funder and the reviewer can
still claim their `4000000`.

## Hash conventions (offchain, must match between B and C)

- `prHash = keccak256(abi.encode(uint256 github_repo_id, uint256 github_pr_number))`
  — viem: `keccak256(encodeAbiParameters([{type:'uint256'},{type:'uint256'}], [repoId, prNumber]))`.
  Uses the immutable numeric GitHub repo id, not the `owner/name` string. Must be non-zero.
- `claimId` — chosen by the backend (Engineer B), must be non-zero and is **single-use across
  all bounties**. Suggested: `keccak256(abi.encode(uint256 github_comment_id))`, which also
  means one review comment can be paid at most once ever.

## Functions

### `createBounty(bytes32 prHash, uint256 amount, uint64 expiry) returns (uint256 bountyId)`
- Caller becomes the bounty's immutable **funder** (the only approver, the only refund target).
- Caller must first `approve` the escrow for ≥ `amount` USDC. Pulls exactly `amount`.
- `expiry`: unix seconds, must be `> block.timestamp`. Bounty is *expired* once `block.timestamp >= expiry`.
- `bountyId` starts at `1` and increments. Read it from the `BountyFunded` event / tx receipt.
- Reverts: `ZeroPrHash`, `ZeroAmount`, `ExpiryNotInFuture(expiry)`, or the USDC token's own
  revert when the allowance or balance is short. **On Arc this is a plain `Error(string)`, not a
  custom error.** Verified with `eth_call` against the live Arc USDC: a missing allowance gives
  `"ERC20: transfer amount exceeds allowance"`. Decode it as a revert reason string. (The test
  mock uses OpenZeppelin v5's `ERC20InsufficientAllowance`, so don't match on that in app code.)

### `approveReward(uint256 bountyId, address recipient, uint256 amount, bytes32 claimId)`
- **Only the funder** may call. The backend prepares these four arguments; the maintainer signs.
- Once per bounty, before expiry. `0 < amount <= funded amount`. `recipient` ≠ zero, ≠ funder.
- Commits `amount` to `recipient`; moves no money.
- Reverts: `BountyNotFound`, `NotFunder(bountyId, caller)`, `BountyExpired(bountyId)`,
  `AlreadyApproved(bountyId)`, `InvalidRecipient(recipient)`, `ZeroAmount`,
  `AmountExceedsBalance(bountyId, requested, available)`, `ZeroClaimId`, `ClaimIdAlreadyUsed(claimId)`.

### `claim(uint256 bountyId)`
- Only the approved recipient. Pays the approved amount exactly once. Still works after expiry
  (committed funds are never refundable).
- Reverts: `BountyNotFound`, `NotApprovedRecipient(bountyId, caller)` (also before approval),
  **`AlreadyClaimed(bountyId)`** — the duplicate-claim revert shown in the demo.

### `refundExpired(uint256 bountyId)`
- Anyone may send it; USDC goes **only to the funder**. Returns `amount - approvedAmount`. Once.
- Reverts: `BountyNotFound`, `NotExpired(bountyId, expiry)`, `AlreadyRefunded(bountyId)`,
  `NothingToRefund(bountyId)` (everything was approved to the reviewer).

### Views
- `bounties(uint256 id)` returns, in order:
  `(address funder, uint64 expiry, bool paid, bool refunded, address recipient, bytes32 prHash, bytes32 claimId, uint256 amount, uint256 approvedAmount)`.
  Unknown id → all zero (`funder == 0x0`).
- `nextBountyId() → uint256`, `claimIdUsed(bytes32) → bool`, `usdc() → address`.

## Events (topic layout)

`topic0` is the event signature hash. Indexed fields follow in declaration order; the rest is ABI-encoded in `data`.

| Event | topic0 | topic1 | topic2 | topic3 | data |
|---|---|---|---|---|---|
| `BountyFunded(uint256,address,bytes32,uint256,uint64)` | `0x4703133ed190b619ce4034b52cca1182f1f02f8e9de0d24309e35b1b296fe172` | bountyId | funder | prHash | amount, expiry |
| `RewardApproved(uint256,address,uint256,bytes32)` | `0x3830da5ae1d552f7899720c184c3f4576b9f26de96692c90938efbd55467294f` | bountyId | recipient | — | amount, claimId |
| `RewardPaid(uint256,address,uint256,bytes32)` | `0x9f5b59d2a8ccf2f24c6428440048dc2ab3521768467f1a5030098b8e50c8ae6f` | bountyId | recipient | — | amount, claimId |
| `BountyRefunded(uint256,address,uint256)` | `0xf1ed347f033f54c0d6f1589c933d81b4256cf2f72a785106e3653a565f7433a2` | bountyId | funder | — | amount |

These four topic0 values are the Streams filter set (plus the contract address).

## Status transitions each event implies

| Event | SPEC status | Notes |
|---|---|---|
| `BountyFunded` | Funding pending → **Funded** | onchain-authoritative |
| `RewardApproved` | Review candidate → **Approved / Claimable** | recipient can claim immediately |
| `RewardPaid` | Claimable → **Paid** | onchain-authoritative, terminal for the reviewer share |
| `BountyRefunded` | Expired → **Refunded** | onchain-authoritative. If a reward was approved, the bounty can be both refunded (remainder) and later paid (reviewer share) — show both |

"Expired" has no event: it is `block.timestamp >= expiry`, compute it from the `BountyFunded.expiry`.
Draft, Review candidate and Rejected are backend/GitHub states with no onchain counterpart.

## Custom error selectors

| Error | Selector |
|---|---|
| `AlreadyApproved(uint256)` | `0xbc6974e1` |
| `AlreadyClaimed(uint256)` | `0xb3167bfa` |
| `AlreadyRefunded(uint256)` | `0x81fd8f27` |
| `AmountExceedsBalance(uint256,uint256,uint256)` | `0x14164711` |
| `BountyExpired(uint256)` | `0x7e457261` |
| `BountyNotFound(uint256)` | `0xe50c81e6` |
| `ClaimIdAlreadyUsed(bytes32)` | `0x3ce79b67` |
| `ExpiryNotInFuture(uint64)` | `0x8d499f7d` |
| `InvalidRecipient(address)` | `0x17858bbe` |
| `NotApprovedRecipient(uint256,address)` | `0xfd1cd65c` |
| `NotExpired(uint256,uint64)` | `0x7c683ddf` |
| `NotFunder(uint256,address)` | `0x8469273b` |
| `NothingToRefund(uint256)` | `0xe0a5cd91` |
| `ZeroAmount()` | `0x1f2a2005` |
| `ZeroClaimId()` | `0xc6a7859f` |
| `ZeroPrHash()` | `0x1cbdc79e` |
| `ReentrancyGuardReentrantCall()` (OpenZeppelin) | `0x3ee5aeb5` |
| `SafeERC20FailedOperation(address)` (OpenZeppelin) | `0x5274afe7` |

The ABI includes all of these, so viem's `decodeErrorResult` / `BaseError.walk()` gives the name directly.

## Authorization: one interpretation to know about

The brief allows "the funder, **or** a maintainer wallet registered at funding time" to approve.
This contract implements **funder-only** to keep the frozen `createBounty` signature unchanged:
the maintainer funds and approves from the same wallet. If the team needs a separate maintainer
wallet, that is an added `createBounty` argument — a SPEC change, and A will PR it.
