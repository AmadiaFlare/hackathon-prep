// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TestFtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IFtsoFeedPublisher} from "@flarenetwork/flare-periphery-contracts/coston2/IFtsoFeedPublisher.sol";

contract AnchorFeedConsumer {
   
    IFtsoFeedPublisher private immutable ftsoFeedPublisher;

    constructor() {
        ftsoFeedPublisher = ContractRegistry.getFtsoFeedPublisher();
    }

    function getFeedsHistorySize() external view returns (uint256) {
        return ftsoFeedPublisher.feedsHistorySize();
    }

    function getFtsoProtocolId() external view returns (uint8) {
        return ftsoFeedPublisher.ftsoProtocolId();
    }

    function getCurrentFeed(bytes21 _feedId) external view returns (IFtsoFeedPublisher.Feed memory) {
        return ftsoFeedPublisher.getCurrentFeed(_feedId);
    }

    function getFeed(bytes21 _feedId, uint256 _votingRoundId) external view returns (IFtsoFeedPublisher.Feed memory) {
        return ftsoFeedPublisher.getFeed(_feedId, _votingRoundId);
    }
}