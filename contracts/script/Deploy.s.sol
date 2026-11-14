// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

/// @notice Deploys BountyEscrow on Arc testnet. The deployer key comes from the CLI
///         (--private-key / --account), never from this file. See `make deploy-arc`.
contract Deploy is Script {
    uint256 constant ARC_TESTNET_CHAIN_ID = 5042002;
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (BountyEscrow escrow) {
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "Deploy: not Arc testnet (5042002)");
        vm.startBroadcast();
        escrow = new BountyEscrow(IERC20(ARC_USDC));
        vm.stopBroadcast();
        console.log("BountyEscrow deployed at", address(escrow));
    }
}
