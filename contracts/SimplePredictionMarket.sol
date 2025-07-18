// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

/**
 * @title SimplePredictionMarket
 * @dev A simplified prediction market settled by the Flare Time Series Oracle (FTSO).
 * This contract represents a single market for a specific price feed and settlement time.
 */
contract SimplePredictionMarket {
    // will have to enter 0,1,2 when calling bet method
    enum Position { None, Above, Below }

    TestFtsoV2Interface private _ftsoV2;

    // Market parameters
    bytes21 public immutable feedId;
    uint256 public immutable targetPrice;
    uint256 public immutable settlementTime;

    // Betting pools
    uint256 public abovePool;
    uint256 public belowPool;
    mapping(address => uint256) public betsAbove;
    mapping(address => uint256) public betsBelow;

    // Settlement state
    bool public isSettled;
    Position public winningPosition;

    event BetPlaced(address indexed user, Position position, uint256 amount);
    event MarketSettled(Position winningPosition, uint256 finalPrice);
    event WinningsClaimed(address indexed user, uint256 amount);

    /**
     * @param _feedId The FTSO feed ID for the asset (e.g., FLR/USD).
     * @param _targetPrice The price point to bet against.
     * @param _settlementTime The UNIX timestamp when the market settles.
     */
    constructor(bytes21 _feedId, uint256 _targetPrice, uint256 _settlementTime) {
        require(_settlementTime > block.timestamp, "Settlement time must be in the future");
        feedId = _feedId;
        targetPrice = _targetPrice;
        settlementTime = _settlementTime;
        _ftsoV2 = ContractRegistry.getTestFtsoV2();
    }

    /**
     * @dev Places a bet on either the Above or Below position.
     */
    function bet(Position position) external payable {
        require(!isSettled, "Market is already settled");
        require(block.timestamp < settlementTime, "Betting has closed");
        require(msg.value > 0, "Bet amount must be greater than zero");
        require(position == Position.Above || position == Position.Below, "Invalid position");

        if (position == Position.Above) {
            betsAbove[msg.sender] += msg.value;
            abovePool += msg.value;
        } else {
            betsBelow[msg.sender] += msg.value;
            belowPool += msg.value;
        }

        emit BetPlaced(msg.sender, position, msg.value);
    }

    /**
     * @dev Settles the market by fetching the price from the FTSO.
     */
    function settle() external {
        require(!isSettled, "Market is already settled");
        require(block.timestamp >= settlementTime, "Settlement time not yet reached");

        (uint256 finalPrice, ,) = _ftsoV2.getFeedById(feedId);
        require(finalPrice > 0, "Oracle price unavailable");

        if (finalPrice > targetPrice) {
            winningPosition = Position.Above;
        } else {
            winningPosition = Position.Below;
        }

        isSettled = true;
        emit MarketSettled(winningPosition, finalPrice);
    }

    /**
     * @dev Allows winners to claim their proportional share of the total pool.
     */
    function claimWinnings() external {
        require(isSettled, "Market is not yet settled");

        uint256 userBet;
        uint256 payout;

        if (winningPosition == Position.Above) {
            userBet = betsAbove[msg.sender];
            require(userBet > 0, "You did not bet on the winning position");
            payout = (userBet * (abovePool + belowPool)) / abovePool;
            betsAbove[msg.sender] = 0; // Prevent re-entry
        } else if (winningPosition == Position.Below) {
            userBet = betsBelow[msg.sender];
            require(userBet > 0, "You did not bet on the winning position");
            payout = (userBet * (abovePool + belowPool)) / belowPool;
            betsBelow[msg.sender] = 0; // Prevent re-entry
        } else {
            revert("Market resulted in a draw or was not settled correctly");
        }

        require(payout > 0, "No payout available");
        emit WinningsClaimed(msg.sender, payout);

        (bool sent, ) = msg.sender.call{value: payout}("");
        require(sent, "Failed to send winnings");
    }
}
