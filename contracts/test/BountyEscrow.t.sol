// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

contract BountyEscrowTest is Test {
    BountyEscrow escrow;
    MockUSDC usdc;

    address maintainer = makeAddr("maintainer");
    address reviewer = makeAddr("reviewer");
    address stranger = makeAddr("stranger");

    uint256 constant TEN_USDC = 10_000_000; // $10.00 at 6 decimals
    bytes32 constant PR = keccak256(abi.encode(uint256(123456), uint256(42))); // (repo id, PR number)
    bytes32 constant CLAIM = keccak256("review-comment:987654321");
    uint64 expiry;

    event BountyFunded(
        uint256 indexed bountyId, address indexed funder, bytes32 indexed prHash, uint256 amount, uint64 expiry
    );
    event RewardApproved(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
    event RewardPaid(uint256 indexed bountyId, address indexed recipient, uint256 amount, bytes32 claimId);
    event BountyRefunded(uint256 indexed bountyId, address indexed funder, uint256 amount);

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new BountyEscrow(usdc);
        expiry = uint64(block.timestamp + 7 days);
        usdc.mint(maintainer, 1_000 * 1e6);
        vm.prank(maintainer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _fund(uint256 amount) internal returns (uint256) {
        vm.prank(maintainer);
        return escrow.createBounty(PR, amount, expiry);
    }

    function _fundAndApprove(uint256 funded, uint256 approved) internal returns (uint256 id) {
        id = _fund(funded);
        vm.prank(maintainer);
        escrow.approveReward(id, reviewer, approved, CLAIM);
    }

    function _recipient(uint256 id) internal view returns (address r) {
        (,,,, r,,,,) = escrow.bounties(id);
    }

    // ---------- createBounty ----------

    function test_fund_transfersExactAmountAndEmits() public {
        uint256 before = usdc.balanceOf(maintainer);
        vm.expectEmit(address(escrow));
        emit BountyFunded(1, maintainer, PR, TEN_USDC, expiry);
        uint256 id = _fund(TEN_USDC);

        assertEq(id, 1);
        assertEq(escrow.nextBountyId(), 2);
        assertEq(usdc.balanceOf(address(escrow)), TEN_USDC);
        assertEq(usdc.balanceOf(maintainer), before - TEN_USDC);

        (address funder, uint64 exp, bool paid, bool refunded, address recipient, bytes32 prHash,, uint256 amount,) =
            escrow.bounties(id);
        assertEq(funder, maintainer);
        assertEq(exp, expiry);
        assertFalse(paid);
        assertFalse(refunded);
        assertEq(recipient, address(0));
        assertEq(prHash, PR);
        assertEq(amount, TEN_USDC);
    }

    function test_fund_insufficientAllowanceReverts() public {
        vm.prank(maintainer);
        usdc.approve(address(escrow), TEN_USDC - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), TEN_USDC - 1, TEN_USDC
            )
        );
        _fund(TEN_USDC);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.nextBountyId(), 1);
    }

    function test_fund_insufficientBalanceReverts() public {
        vm.startPrank(stranger);
        usdc.approve(address(escrow), TEN_USDC);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, TEN_USDC)
        );
        escrow.createBounty(PR, TEN_USDC, expiry);
        vm.stopPrank();
    }

    function test_fund_rejectsBadInputs() public {
        vm.startPrank(maintainer);
        vm.expectRevert(BountyEscrow.ZeroPrHash.selector);
        escrow.createBounty(bytes32(0), TEN_USDC, expiry);
        vm.expectRevert(BountyEscrow.ZeroAmount.selector);
        escrow.createBounty(PR, 0, expiry);
        uint64 nowTs = uint64(block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ExpiryNotInFuture.selector, nowTs));
        escrow.createBounty(PR, TEN_USDC, nowTs);
        vm.stopPrank();
    }

    // ---------- approveReward ----------

    function test_approve_emitsAndRecords() public {
        uint256 id = _fund(TEN_USDC);
        vm.expectEmit(address(escrow));
        emit RewardApproved(id, reviewer, TEN_USDC, CLAIM);
        vm.prank(maintainer);
        escrow.approveReward(id, reviewer, TEN_USDC, CLAIM);

        assertEq(_recipient(id), reviewer);
        assertTrue(escrow.claimIdUsed(CLAIM));
        assertEq(usdc.balanceOf(address(escrow)), TEN_USDC); // approval moves no money
    }

    function test_foreignFunderCannotConsumeMaintainersClaimId() public {
        usdc.mint(stranger, TEN_USDC);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), TEN_USDC);
        uint256 foreign = escrow.createBounty(PR, TEN_USDC, expiry);
        escrow.approveReward(foreign, reviewer, TEN_USDC, CLAIM);
        vm.stopPrank();
        assertTrue(escrow.claimIdUsed(CLAIM));
        assertTrue(escrow.claimIdUsedBy(stranger, CLAIM));
        assertFalse(escrow.claimIdUsedBy(maintainer, CLAIM));
        uint256 own = _fundAndApprove(TEN_USDC, TEN_USDC);
        assertTrue(escrow.claimIdUsedBy(maintainer, CLAIM));
        vm.prank(reviewer);
        escrow.claim(own);
        assertEq(usdc.balanceOf(reviewer), TEN_USDC);
        uint256 duplicate = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimIdAlreadyUsed.selector, CLAIM));
        escrow.approveReward(duplicate, reviewer, TEN_USDC, CLAIM);
    }

    function test_approve_unauthorizedReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotFunder.selector, id, stranger));
        escrow.approveReward(id, reviewer, TEN_USDC, CLAIM);

        // the reviewer cannot approve themselves either
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotFunder.selector, id, reviewer));
        escrow.approveReward(id, reviewer, TEN_USDC, CLAIM);
    }

    function test_approve_funderCannotPayThemselves() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.InvalidRecipient.selector, maintainer));
        escrow.approveReward(id, maintainer, TEN_USDC, CLAIM);
    }

    function test_approve_zeroRecipientReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.InvalidRecipient.selector, address(0)));
        escrow.approveReward(id, address(0), TEN_USDC, CLAIM);
    }

    function test_approve_moreThanBalanceReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(
            abi.encodeWithSelector(BountyEscrow.AmountExceedsBalance.selector, id, TEN_USDC + 1, TEN_USDC)
        );
        escrow.approveReward(id, reviewer, TEN_USDC + 1, CLAIM);
    }

    function test_approve_zeroAmountReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(BountyEscrow.ZeroAmount.selector);
        escrow.approveReward(id, reviewer, 0, CLAIM);
    }

    function test_approve_onlyOnce() public {
        uint256 id = _fundAndApprove(TEN_USDC, 1e6);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyApproved.selector, id));
        escrow.approveReward(id, stranger, 1e6, keccak256("other"));
    }

    function test_approve_claimIdReplayAcrossBountiesReverts() public {
        _fundAndApprove(TEN_USDC, TEN_USDC);
        uint256 id2 = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.ClaimIdAlreadyUsed.selector, CLAIM));
        escrow.approveReward(id2, reviewer, TEN_USDC, CLAIM);
    }

    function test_approve_zeroClaimIdReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(maintainer);
        vm.expectRevert(BountyEscrow.ZeroClaimId.selector);
        escrow.approveReward(id, reviewer, TEN_USDC, bytes32(0));
    }

    function test_approve_afterExpiryReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.warp(expiry);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyExpired.selector, id));
        escrow.approveReward(id, reviewer, TEN_USDC, CLAIM);
    }

    function test_unknownBountyReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyNotFound.selector, 99));
        escrow.approveReward(99, reviewer, 1, CLAIM);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyNotFound.selector, 99));
        escrow.claim(99);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyNotFound.selector, 99));
        escrow.refundExpired(99);
    }

    // ---------- claim ----------

    function test_claim_paysApprovedRecipient() public {
        uint256 id = _fundAndApprove(TEN_USDC, TEN_USDC);
        vm.expectEmit(address(escrow));
        emit RewardPaid(id, reviewer, TEN_USDC, CLAIM);
        vm.prank(reviewer);
        escrow.claim(id);

        assertEq(usdc.balanceOf(reviewer), TEN_USDC);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        (,, bool paid,,,,,,) = escrow.bounties(id);
        assertTrue(paid);
    }

    function test_claim_otherAddressReverts() public {
        uint256 id = _fundAndApprove(TEN_USDC, TEN_USDC);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotApprovedRecipient.selector, id, stranger));
        escrow.claim(id);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotApprovedRecipient.selector, id, maintainer));
        escrow.claim(id);
    }

    function test_claim_beforeApprovalReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotApprovedRecipient.selector, id, reviewer));
        escrow.claim(id);
    }

    /// The demo's on-camera revert: second claim fails with AlreadyClaimed(bountyId).
    function test_claim_doubleClaimReverts() public {
        uint256 id = _fundAndApprove(TEN_USDC, TEN_USDC);
        vm.startPrank(reviewer);
        escrow.claim(id);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyClaimed.selector, id));
        escrow.claim(id);
        vm.stopPrank();
        assertEq(usdc.balanceOf(reviewer), TEN_USDC);
    }

    function test_claim_worksAfterExpiry() public {
        uint256 id = _fundAndApprove(TEN_USDC, TEN_USDC);
        vm.warp(expiry + 365 days);
        vm.prank(reviewer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(reviewer), TEN_USDC);
    }

    // ---------- refundExpired ----------

    function test_refund_beforeExpiryReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.warp(expiry - 1);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotExpired.selector, id, expiry));
        escrow.refundExpired(id);
    }

    function test_refund_fullAmountToFunderOnly() public {
        uint256 id = _fund(TEN_USDC);
        uint256 before = usdc.balanceOf(maintainer);
        vm.warp(expiry);
        vm.expectEmit(address(escrow));
        emit BountyRefunded(id, maintainer, TEN_USDC);
        vm.prank(stranger); // anyone may trigger; money still goes to the funder
        escrow.refundExpired(id);

        assertEq(usdc.balanceOf(maintainer), before + TEN_USDC);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_returnsOnlyUncommittedBalance() public {
        uint256 id = _fundAndApprove(TEN_USDC, 4e6);
        uint256 before = usdc.balanceOf(maintainer);
        vm.warp(expiry);
        escrow.refundExpired(id);
        assertEq(usdc.balanceOf(maintainer), before + 6e6);
        assertEq(usdc.balanceOf(address(escrow)), 4e6); // reviewer's share untouched

        vm.prank(reviewer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(reviewer), 4e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// Approval and refund cannot spend the same balance.
    function test_refund_fullyApprovedHasNothingToRefund() public {
        uint256 id = _fundAndApprove(TEN_USDC, TEN_USDC);
        vm.warp(expiry);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NothingToRefund.selector, id));
        escrow.refundExpired(id);

        vm.prank(reviewer);
        escrow.claim(id);
        assertEq(usdc.balanceOf(reviewer), TEN_USDC);
    }

    function test_refund_afterRefundCannotApprove() public {
        uint256 id = _fund(TEN_USDC);
        vm.warp(expiry);
        escrow.refundExpired(id);
        vm.prank(maintainer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.BountyExpired.selector, id));
        escrow.approveReward(id, reviewer, TEN_USDC, CLAIM);
    }

    function test_refund_twiceReverts() public {
        uint256 id = _fund(TEN_USDC);
        vm.warp(expiry);
        escrow.refundExpired(id);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.AlreadyRefunded.selector, id));
        escrow.refundExpired(id);
    }

    function test_bountiesAreIsolated() public {
        uint256 a = _fundAndApprove(TEN_USDC, TEN_USDC);
        uint256 b = _fund(5e6);
        vm.prank(reviewer);
        escrow.claim(a);
        vm.warp(expiry);
        escrow.refundExpired(b);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        vm.prank(reviewer);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotApprovedRecipient.selector, b, reviewer));
        escrow.claim(b);
    }

    // ---------- reentrancy ----------

    function test_reentrancy_claimBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        BountyEscrow e = new BountyEscrow(evil);
        evil.mint(maintainer, TEN_USDC);
        vm.startPrank(maintainer);
        evil.approve(address(e), TEN_USDC);
        uint256 id = e.createBounty(PR, TEN_USDC, expiry);
        e.approveReward(id, address(evil), TEN_USDC, CLAIM); // the token itself is the recipient
        vm.stopPrank();

        evil.arm(e, id, false);
        evil.callClaim(id); // outer claim succeeds; inner re-entrant claim must fail

        assertTrue(evil.attempted());
        assertEq(evil.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(evil.balanceOf(address(evil)), TEN_USDC); // paid exactly once
        assertEq(evil.balanceOf(address(e)), 0);
    }

    function test_reentrancy_refundBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        BountyEscrow e = new BountyEscrow(evil);
        evil.mint(maintainer, TEN_USDC);
        vm.startPrank(maintainer);
        evil.approve(address(e), TEN_USDC);
        uint256 id = e.createBounty(PR, TEN_USDC, expiry);
        vm.stopPrank();

        evil.arm(e, id, true);
        vm.warp(expiry);
        e.refundExpired(id);

        assertTrue(evil.attempted());
        assertEq(evil.reentryError(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(evil.balanceOf(maintainer), TEN_USDC); // refunded exactly once
        assertEq(evil.balanceOf(address(e)), 0);
    }

    // ---------- fuzz ----------

    function testFuzz_fundApproveClaimRefund(uint256 funded, uint256 approved, uint64 exp, uint64 refundAt) public {
        funded = bound(funded, 1, 1_000 * 1e6);
        approved = bound(approved, 1, funded);
        exp = uint64(bound(exp, block.timestamp + 1, type(uint64).max - 1));
        refundAt = uint64(bound(refundAt, exp, type(uint64).max));

        uint256 start = usdc.balanceOf(maintainer);
        vm.prank(maintainer);
        uint256 id = escrow.createBounty(PR, funded, exp);
        vm.prank(maintainer);
        escrow.approveReward(id, reviewer, approved, CLAIM);

        vm.warp(refundAt);
        if (funded > approved) escrow.refundExpired(id);
        vm.prank(reviewer);
        escrow.claim(id);

        // conservation: nothing created, nothing stuck, nothing paid twice
        assertEq(usdc.balanceOf(reviewer), approved);
        assertEq(usdc.balanceOf(maintainer), start - approved);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function testFuzz_approveOverBalanceAlwaysReverts(uint256 funded, uint256 extra) public {
        funded = bound(funded, 1, 1_000 * 1e6);
        extra = bound(extra, 1, type(uint256).max - funded);
        uint256 id = _fund(funded);
        vm.prank(maintainer);
        vm.expectRevert(
            abi.encodeWithSelector(BountyEscrow.AmountExceedsBalance.selector, id, funded + extra, funded)
        );
        escrow.approveReward(id, reviewer, funded + extra, CLAIM);
    }

    function testFuzz_refundBeforeExpiryAlwaysReverts(uint64 exp, uint64 at) public {
        exp = uint64(bound(exp, block.timestamp + 1, type(uint64).max));
        at = uint64(bound(at, block.timestamp, exp - 1));
        vm.prank(maintainer);
        uint256 id = escrow.createBounty(PR, TEN_USDC, exp);
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(BountyEscrow.NotExpired.selector, id, exp));
        escrow.refundExpired(id);
    }
}
