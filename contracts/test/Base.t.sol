// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EarnKitCampaigns} from "../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../src/EarnKitCampaign.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

abstract contract BaseTest is Test {
    EarnKitCampaigns factory;
    MockERC20 usdc;
    address owner = makeAddr("owner"); // stands in for the timelock
    address operator = makeAddr("operator");
    address treasury = makeAddr("treasury");
    address pauser = makeAddr("pauser");
    address sponsor = makeAddr("sponsor");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant CAP = 10_000e6;
    bytes32 constant REF = keccak256("ref-1");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        usdc = new MockERC20();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory caps = new uint256[](1);
        caps[0] = CAP;
        factory = new EarnKitCampaigns(owner, operator, treasury, pauser, tokens, caps);
        usdc.mint(sponsor, 1_000_000e6);
        vm.prank(sponsor);
        usdc.approve(address(factory), type(uint256).max);
    }

    function create(uint256 amount, uint64 endsAt) internal returns (EarnKitCampaign c) {
        vm.prank(sponsor);
        c = EarnKitCampaign(factory.createCampaign(REF, IERC20(address(usdc)), amount, endsAt));
    }

    function one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function oneAmt(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }
}
