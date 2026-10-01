// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EarnKitCampaigns} from "../../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../../src/EarnKitCampaign.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// Random sponsors/operators/strangers creating, awarding, refunding, warping, and reconfiguring.
contract Handler is Test {
    EarnKitCampaigns public factory;
    MockERC20 public usdc;
    address public owner;
    address public operator;
    address public treasury;
    address[] public actors;
    EarnKitCampaign[] public campaigns;

    // Ghost accounting: what each party should have received.
    uint256 public ghostDeposited;
    uint256 public ghostToWinners;
    uint256 public ghostToTreasury;
    uint256 public ghostRefunded;
    mapping(address => bool) public isWinnerAddr;

    constructor(EarnKitCampaigns f, MockERC20 t, address owner_, address operator_, address treasury_) {
        (factory, usdc, owner, operator, treasury) = (f, t, owner_, operator_, treasury_);
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(a);
            usdc.mint(a, 1_000_000e6);
            vm.prank(a);
            usdc.approve(address(factory), type(uint256).max);
        }
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function create(uint256 actorSeed, uint256 amount, uint256 duration) external {
        address a = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 10_000e6);
        duration = bound(duration, 1, 180 days);
        vm.prank(a);
        try factory.createCampaign(
            keccak256(abi.encode(campaigns.length)), IERC20(address(usdc)), amount, uint64(block.timestamp + duration)
        ) returns (address c) {
            campaigns.push(EarnKitCampaign(c));
            ghostDeposited += amount;
        } catch {}
    }

    function award(uint256 idx, uint256 callerSeed, uint256 split) external {
        if (campaigns.length == 0) return;
        EarnKitCampaign c = campaigns[idx % campaigns.length];
        address caller = callerSeed % 3 == 0 ? c.sponsor() : callerSeed % 3 == 1 ? operator : actors[callerSeed % actors.length];
        uint256 prize = c.prize();
        address[] memory w = new address[](2);
        uint256[] memory amt = new uint256[](2);
        w[0] = makeAddr("winnerA");
        w[1] = makeAddr("winnerB");
        uint256 first = prize <= 1 ? prize : bound(split, 1, prize - 1);
        amt[0] = first;
        amt[1] = prize - first;
        uint256 fee = c.fee();
        vm.prank(caller);
        try c.award(w, amt) {
            ghostToWinners += prize;
            ghostToTreasury += fee;
            isWinnerAddr[w[0]] = true;
            isWinnerAddr[w[1]] = true;
        } catch {}
    }

    function refund(uint256 idx, uint256 callerSeed) external {
        if (campaigns.length == 0) return;
        EarnKitCampaign c = campaigns[idx % campaigns.length];
        address caller = callerSeed % 3 == 0 ? c.sponsor() : callerSeed % 3 == 1 ? operator : owner;
        uint256 amount = c.prize() + c.fee();
        vm.prank(caller);
        try c.refund() {
            ghostRefunded += amount;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 30 days));
    }

    function ownerReconfigures(uint256 cap) external {
        vm.startPrank(owner);
        factory.setCap(address(usdc), bound(cap, 1, 10_000e6));
        factory.setTreasury(treasury); // same treasury: invariants track one address
        vm.stopPrank();
    }

    function pauseToggle(bool on) external {
        vm.prank(owner);
        if (on) try factory.pause() {} catch {}
        else try factory.unpause() {} catch {}
    }
}
