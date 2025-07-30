// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

/**
 * @title FTSOPriceGuesser
 * @notice A simple contract where users can guess if the FLR/USD price will be above or below a target.
 *         Guesses are resolved by verifying an FTSO proof on-chain.
 */
contract FTSOPriceGuesser {
    enum Prediction {
        BELOW,
        ABOVE
    }

    struct Guess {
        bool hasGuessed;
        bool isResolved;
        bool wasCorrect;
        uint256 targetPrice;
        Prediction prediction;
    }

    mapping(address => Guess) public guesses;

    bytes21 private constant FLR_USD_ID =
        0x01464c522f55534400000000000000000000000000;

    event GuessMade(
        address indexed guesser,
        uint256 targetPrice,
        Prediction prediction
    );
    event GuessResolved(
        address indexed guesser,
        uint256 actualPrice,
        bool wasCorrect
    );

    /**
     * @notice Make a guess about the FLR/USD price.
     * @param _targetPrice The price point to guess against (with 5 decimals, e.g., 20000 for $0.20).
     * @param _prediction Whether the price will be ABOVE or BELOW the target.
     */
    function makeGuess(uint256 _targetPrice, Prediction _prediction) external {
        require(!guesses[msg.sender].hasGuessed, "You already have an active guess.");

        guesses[msg.sender] = Guess({
            hasGuessed: true,
            isResolved: false,
            wasCorrect: false,
            targetPrice: _targetPrice,
            prediction: _prediction
        });

        emit GuessMade(msg.sender, _targetPrice, _prediction);
    }

    /**
     * @notice Resolves a guess using a proof from the Flare DA Layer.
     * @param _guesser The address of the user whose guess is being resolved.
     * @param _proof The FTSO proof data corresponding to a finalized round.
     */
    function resolveGuess(
        address _guesser,
        FtsoV2Interface.FeedDataWithProof calldata _proof
    ) external {
        Guess storage userGuess = guesses[_guesser];
        require(userGuess.hasGuessed, "No active guess for this address.");
        require(!userGuess.isResolved, "Guess has already been resolved.");

        // Step 1: Verify the FTSO proof is valid and from a trusted source.
        FtsoV2Interface ftsoV2 = ContractRegistry.getFtsoV2();
        require(ftsoV2.verifyFeedData(_proof), "FTSO proof verification failed");

        // Step 2: Ensure the proof is for the FLR/USD price feed.
        require(_proof.body.id == FLR_USD_ID, "Proof is not for FLR/USD");

        // Step 3: Determine the outcome based on the verified price.
        int256 actualPrice = _proof.body.value;
        bool isPriceActuallyAbove = uint256(actualPrice) > userGuess.targetPrice;

        bool wasPredictionCorrect;
        if (userGuess.prediction == Prediction.ABOVE) {
            wasPredictionCorrect = isPriceActuallyAbove;
        } else {
            wasPredictionCorrect = !isPriceActuallyAbove;
        }

        // Step 4: Update the guess status.
        userGuess.isResolved = true;
        userGuess.wasCorrect = wasPredictionCorrect;

        emit GuessResolved(_guesser, uint256(actualPrice), wasPredictionCorrect);
    }
}