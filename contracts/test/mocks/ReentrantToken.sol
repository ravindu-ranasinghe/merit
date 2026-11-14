// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";
import {BountyEscrow} from "../../src/BountyEscrow.sol";

/// @dev Malicious token: every outgoing transfer from the escrow re-enters the escrow.
///      In the claim test this contract is also the approved recipient, so the re-entrant
///      claim() comes from the legitimate recipient address.
contract ReentrantToken is MockUSDC {
    BountyEscrow public escrow;
    uint256 public targetId;
    bool public attackRefund; // false: re-enter claim(); true: re-enter refundExpired()
    bool public attempted;
    bytes public reentryError;

    function arm(BountyEscrow escrow_, uint256 targetId_, bool attackRefund_) external {
        escrow = escrow_;
        targetId = targetId_;
        attackRefund = attackRefund_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (address(escrow) != address(0) && msg.sender == address(escrow) && !attempted) {
            attempted = true;
            try this.reenter() {} catch (bytes memory err) {
                reentryError = err;
            }
        }
        return super.transfer(to, value);
    }

    function reenter() external {
        if (attackRefund) escrow.refundExpired(targetId);
        else escrow.claim(targetId);
    }

    /// @dev Lets this contract act as the funder/recipient in tests.
    function callApprove(address spender, uint256 value) external {
        _approve(address(this), spender, value);
    }

    function callClaim(uint256 id) external {
        escrow.claim(id);
    }
}
