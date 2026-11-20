# contracts — BountyEscrow (Engineer A)

USDC escrow for ReviewBounty on **Arc testnet** (chain `5042002`). Testnet USDC only.

Interface for teammates (functions, events, topics, errors, units): [`../docs/escrow-interface.md`](../docs/escrow-interface.md).
ABI: [`../docs/escrow-abi.json`](../docs/escrow-abi.json).

| | |
|---|---|
| BountyEscrow | [`0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727`](https://explorer.testnet.arc.io/address/0x924525bF3f3A39f9c7f298E71aFf43F4c27a4727) (verified, deploy block 72270484) |
| USDC | `0x3600000000000000000000000000000000000000` |
| Explorer | https://explorer.testnet.arc.io |

## Commands

Requires [Foundry](https://getfoundry.sh) (`brew install foundry` or `foundryup`).

`contracts/lib/forge-std` and `contracts/lib/openzeppelin-contracts` are git submodules. Without
them `forge build` fails with missing-import errors.

```sh
git clone --recurse-submodules https://github.com/ravindu-ranasinghe/merit.git   # fresh clone
git submodule update --init --recursive                                         # existing clone, or after switching branches
```

**Worktrees:** submodules are checked out per worktree. After `git worktree add`, run
`git submodule update --init --recursive` inside the new worktree too.

```sh
make build      # forge build
make test       # 32 tests incl. fuzz (1000 runs each) and reentrancy
make coverage   # escrow coverage: 100% lines / statements / branches / functions
make abi        # regenerate ../docs/escrow-abi.json

cp .env.example .env   # set DEPLOYER_PRIVATE_KEY (testnet-only key, funded at https://faucet.circle.com)
make deploy-arc        # deploy + verify on the Arc explorer (Blockscout)
make verify-arc        # retry verification only (needs ESCROW_ADDRESS)
```

## How it works

1. **Fund** — maintainer approves USDC and calls `createBounty(prHash, amount, expiry)`. Money is locked.
2. **Approve** — after the backend surfaces GitHub evidence, the maintainer signs
   `approveReward(bountyId, reviewer, amount, claimId)` from the funding wallet.
3. **Claim** — the reviewer calls `claim(bountyId)` and receives the USDC. Exactly once.
4. **Refund** — after `expiry`, anyone may call `refundExpired(bountyId)`; the unapproved
   remainder returns to the funder. Approved funds stay claimable.

## Trust model, plainly

- **Nobody but the funder can direct the money.** No owner, no admin, no pause, no upgrade.
  The backend holds no key; it only prepares the approval the maintainer signs.
- Money leaves the contract only as (a) a claim by the one approved reviewer, up to the
  funded amount, once, or (b) an expired refund of the unapproved remainder to the original funder.
- The funder cannot approve themselves as recipient. A bounty pays at most one reviewer, once.
  In the revised contract, a `claimId` can be used once per immutable funder across their bounties.
  Another funder cannot consume it first. The active legacy deployment still uses a global guard;
  see [the deployment handoff](../docs/escrow-upgrade.md) before deploying or changing configuration.
- **Limitation:** the contract does not judge review quality. A maintainer can approve a
  low-quality review, and collusion between PR author, reviewer and maintainer is possible.
  Blockchain does not solve subjective review assessment. Checks like "no payout to the PR
  author" are GitHub-side and live in the backend, not here.
- Expiry needs a transaction: the contract cannot act on a clock.
- **Limitation:** approved USDC belongs to the approved reviewer and is never refundable. If
  they never claim (lost key, or the address is blocked by the USDC issuer), those funds stay
  locked in the escrow. This is the price of "nobody else can redirect committed money".
