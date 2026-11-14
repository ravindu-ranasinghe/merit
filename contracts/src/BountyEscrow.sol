// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BountyEscrow — USDC escrow for paid code reviews (ReviewBounty, testnet prototype)
/// @notice A maintainer locks USDC against one GitHub pull request before review starts.
///         Later the same maintainer approves one reviewer, who claims the reward once.
///         Anything not approved goes back to the funder after expiry.
///
/// TRUST MODEL — read this first.
///   * Only the wallet that funded a bounty can approve its payout. There is no owner,
///     no admin, no backend key and no upgrade path: nobody else can move escrowed USDC.
///   * The ReviewBounty backend reads GitHub and *prepares* an approval (recipient, amount,
///     claimId). It never signs it. The maintainer reviews that evidence and signs
///     `approveReward` from their own wallet.
///   * This contract does not judge review quality. A maintainer can approve a weak review;
///     author/reviewer/maintainer collusion is possible. Those are disclosed limitations.
///   * The contract cannot act on a clock: expiry only takes effect when someone sends
///     `refundExpired`.
///
/// Units: every amount is an integer in USDC base units (6 decimals). $10.00 == 10_000_000.
contract BountyEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Bounty {
        address funder; //         immutable after funding; the only approver, the only refund target
        uint64 expiry; //          unix seconds; expired once block.timestamp >= expiry
        bool paid; //              recipient has claimed
        bool refunded; //          uncommitted balance returned to funder
        address recipient; //      set once by approveReward; zero until then
        bytes32 prHash; //         opaque hash of (repo id, PR number), computed offchain
        bytes32 claimId; //        backend-derived id of the approved review, single use
        uint256 amount; //         funded amount
        uint256 approvedAmount; // committed to recipient; cannot be refunded
    }

    IERC20 public immutable usdc;

    /// @notice Id the next createBounty will return. Ids start at 1; 0 means "no bounty".
    uint256 public nextBountyId = 1;

    mapping(uint256 bountyId => Bounty) public bounties;

    /// @notice claimIds ever used in an approval, across all bounties (replay guard).
    mapping(bytes32 claimId => bool) public claimIdUsed;

    event BountyFunded(
        uint256 indexed bountyId, address indexed funder, bytes32 indexed prHash, uint256 amount, uint64 expiry
    );
    event RewardApproved(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
    event RewardPaid(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
    event BountyRefunded(uint256 indexed bountyId, address indexed funder, uint256 amount);

    error ZeroAmount();
    error ZeroPrHash();
    error ZeroClaimId();
    error ExpiryNotInFuture(uint64 expiry);
    error BountyNotFound(uint256 bountyId);
    error NotFunder(uint256 bountyId, address caller);
    error BountyExpired(uint256 bountyId);
    error AlreadyApproved(uint256 bountyId);
    error InvalidRecipient(address recipient);
    error AmountExceedsBalance(uint256 bountyId, uint256 requested, uint256 available);
    error ClaimIdAlreadyUsed(bytes32 claimId);
    error NotApprovedRecipient(uint256 bountyId, address caller);
    error AlreadyClaimed(uint256 bountyId);
    error NotExpired(uint256 bountyId, uint64 expiry);
    error AlreadyRefunded(uint256 bountyId);
    error NothingToRefund(uint256 bountyId);

    constructor(IERC20 usdc_) {
        usdc = usdc_;
    }

    /// @notice Lock `amount` USDC against a PR. Caller must have approved this contract for `amount`.
    /// @param prHash keccak256 of the PR identity (repo id + PR number); stored and emitted, never parsed.
    /// @param amount USDC base units (6 decimals).
    /// @param expiry unix seconds after which unapproved funds can be refunded to the caller.
    function createBounty(bytes32 prHash, uint256 amount, uint64 expiry) external returns (uint256 bountyId) {
        if (prHash == bytes32(0)) revert ZeroPrHash();
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert ExpiryNotInFuture(expiry);

        bountyId = nextBountyId++;
        Bounty storage b = bounties[bountyId];
        b.funder = msg.sender;
        b.expiry = expiry;
        b.prHash = prHash;
        b.amount = amount;

        emit BountyFunded(bountyId, msg.sender, prHash, amount, expiry);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Funder commits `amount` of the bounty to one reviewer. Callable once, before expiry.
    /// @dev The backend proposes these arguments from GitHub evidence; the funder signs. The funder
    ///      cannot name themselves, so a maintainer cannot pay their own bounty to themselves.
    /// @param claimId backend id of the approved review (e.g. hash of the review comment); single use.
    function approveReward(uint256 bountyId, address recipient, uint256 amount, bytes32 claimId) external {
        Bounty storage b = _get(bountyId);
        if (msg.sender != b.funder) revert NotFunder(bountyId, msg.sender);
        if (block.timestamp >= b.expiry) revert BountyExpired(bountyId);
        if (b.recipient != address(0)) revert AlreadyApproved(bountyId);
        if (recipient == address(0) || recipient == b.funder) revert InvalidRecipient(recipient);
        if (amount == 0) revert ZeroAmount();
        if (amount > b.amount) revert AmountExceedsBalance(bountyId, amount, b.amount);
        if (claimId == bytes32(0)) revert ZeroClaimId();
        if (claimIdUsed[claimId]) revert ClaimIdAlreadyUsed(claimId);

        claimIdUsed[claimId] = true;
        b.recipient = recipient;
        b.approvedAmount = amount;
        b.claimId = claimId;

        emit RewardApproved(bountyId, recipient, amount, claimId);
    }

    /// @notice Approved reviewer withdraws their reward. Succeeds exactly once; works after expiry
    ///         too, because approved funds are committed and can never be refunded.
    function claim(uint256 bountyId) external nonReentrant {
        Bounty storage b = _get(bountyId);
        if (msg.sender != b.recipient) revert NotApprovedRecipient(bountyId, msg.sender);
        if (b.paid) revert AlreadyClaimed(bountyId);

        b.paid = true;
        uint256 amount = b.approvedAmount;

        emit RewardPaid(bountyId, msg.sender, amount, b.claimId);
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice After expiry, return the uncommitted balance (amount - approvedAmount) to the original
    ///         funder. Anyone may send this transaction; the USDC only ever goes to the funder.
    function refundExpired(uint256 bountyId) external nonReentrant {
        Bounty storage b = _get(bountyId);
        if (block.timestamp < b.expiry) revert NotExpired(bountyId, b.expiry);
        if (b.refunded) revert AlreadyRefunded(bountyId);
        uint256 refund = b.amount - b.approvedAmount; // approvedAmount <= amount is enforced in approveReward
        if (refund == 0) revert NothingToRefund(bountyId);

        b.refunded = true;

        emit BountyRefunded(bountyId, b.funder, refund);
        usdc.safeTransfer(b.funder, refund);
    }

    function _get(uint256 bountyId) private view returns (Bounty storage b) {
        b = bounties[bountyId];
        if (b.funder == address(0)) revert BountyNotFound(bountyId);
    }
}
