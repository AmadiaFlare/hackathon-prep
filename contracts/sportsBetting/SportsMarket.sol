// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";

/**
 * @title DataTransportObject
 * @notice Defines the structure of the data expected from the Flare Data Connector
 *         after being processed by the JQ filter from the sports API.
 */
struct DataTransportObject {
    uint256 matchId;      // The unique ID of the match from TheSportsDB API.
    uint256 homeScore;    // The final score of the home team.
    uint256 awayScore;    // The final score of the away team.
    string status;        // The status of the match, expecting "Match Finished".
}

/**
 * @title SportsMarket
 * @notice A smart contract for a decentralized betting market on a single sports event.
 * @dev The outcome is resolved trustlessly using Flare's Data Connector.
 */
contract SportsMarket {
    // --- Enums ---

    enum MarketStatus {
        Open,      // Accepting bets
        Locked,    // Event has started, bets are closed, awaiting result
        Resolved,  // Outcome has been determined by the FDC
        Canceled   // Market has been canceled
    }

    enum Team {
        None,
        Home,
        Away
    }

    // --- Structs ---

    struct Bet {
        address payable bettor; // The address of the bettor.
        Team team;              // The team the bettor wagered on.
        uint256 amount;         // The amount wagered.
        bool claimed;           // Whether the winnings have been claimed.
    }

    // --- State Variables ---

    address public owner;
    uint256 public matchId;
    string public homeTeamName;
    string public awayTeamName;
    uint256 public eventTimestamp; // Bets are locked after this time.
    uint256 public resolveTimestamp; // Earliest time the market can be resolved.

    uint256 public totalHomeBets;
    uint256 public totalAwayBets;
    uint256 public totalPrizePool;

    Bet[] public bets;
    mapping(address => uint256[]) public betsByBettor;

    MarketStatus public status;
    Team public winningTeam;

    // --- Events ---

    event MarketCreated(uint256 indexed matchId, string homeTeam, string awayTeam, uint256 eventTimestamp);
    event BetPlaced(uint256 indexed matchId, address indexed bettor, Team team, uint256 amount);
    event MarketResolved(uint256 indexed matchId, Team winningTeam, uint256 homeScore, uint256 awayScore);
    event MarketCanceled(uint256 indexed matchId);
    event WinningsClaimed(uint256 indexed matchId, address indexed bettor, uint256 amount);

    // --- Constructor ---

    constructor(
        uint256 _matchId,
        string memory _homeTeamName,
        string memory _awayTeamName,
        uint256 _eventTimestamp
    ) {
        owner = msg.sender;
        matchId = _matchId;
        homeTeamName = _homeTeamName;
        awayTeamName = _awayTeamName;
        eventTimestamp = _eventTimestamp;
        resolveTimestamp = _eventTimestamp + 3 hours; // Set resolution window 3 hours after game start.
        status = MarketStatus.Open;

        emit MarketCreated(_matchId, _homeTeamName, _awayTeamName, _eventTimestamp);
    }

    // --- Betting Functions ---

    /**
     * @notice Places a bet on either the home or away team.
     * @param _team The team to bet on (1 for Home, 2 for Away).
     */
    function placeBet(Team _team) external payable {
        require(status == MarketStatus.Open, "Market is not open for betting");
        require(block.timestamp < eventTimestamp, "Betting has now closed for this event");
        require(msg.value > 0, "Bet amount must be greater than zero");
        require(_team == Team.Home || _team == Team.Away, "Invalid team selection");

        if (_team == Team.Home) {
            totalHomeBets += msg.value;
        } else {
            totalAwayBets += msg.value;
        }

        totalPrizePool += msg.value;

        uint256 betId = bets.length;
        bets.push(Bet({
            bettor: payable(msg.sender),
            team: _team,
            amount: msg.value,
            claimed: false
        }));
        betsByBettor[msg.sender].push(betId);

        emit BetPlaced(matchId, msg.sender, _team, msg.value);
    }

    // --- Resolution Functions ---

    /**
     * @notice Locks the market to prevent further betting after the event has started.
     */
    function lockMarket() external {
        require(block.timestamp >= eventTimestamp, "Event has not started yet");
        require(status == MarketStatus.Open, "Market is already locked or resolved");
        status = MarketStatus.Locked;
    }

    /**
     * @notice Resolves the market by verifying a proof from the Flare Data Connector.
     * @param _proof The proof containing the final match results.
     */
    function resolveMarket(IWeb2Json.Proof calldata _proof) external {
        require(status == MarketStatus.Locked, "Market is not locked for resolution");
        require(block.timestamp >= resolveTimestamp, "It is too early to resolve this market");

        // 1. Verify the proof with the FDC Verification contract
        require(ContractRegistry.getFdcVerification().verifyJsonApi(_proof), "FDC: Invalid Web2Json proof");

        // 2. Decode the response body
        DataTransportObject memory dto = abi.decode(
            _proof.data.responseBody.abiEncodedData,
            (DataTransportObject)
        );

        // 3. Validate the data
        require(dto.matchId == matchId, "Proof is for the wrong match");
        require(keccak256(abi.encodePacked(dto.status)) == keccak256(abi.encodePacked("Match Finished")), "Match is not finished yet");

        // 4. Determine the winner
        if (dto.homeScore > dto.awayScore) {
            winningTeam = Team.Home;
        } else if (dto.awayScore > dto.homeScore) {
            winningTeam = Team.Away;
        } else {
            // It's a tie, cancel the market and allow refunds
            status = MarketStatus.Canceled;
            emit MarketCanceled(matchId);
            return;
        }

        // 5. Finalize the market state
        status = MarketStatus.Resolved;
        emit MarketResolved(matchId, winningTeam, dto.homeScore, dto.awayScore);
    }
    
    // --- Payout Functions ---

    /**
     * @notice Allows a user to claim their winnings if they bet on the winning team.
     */
    function claimWinnings() external {
        require(status == MarketStatus.Resolved, "Market is not yet resolved");
        require(winningTeam != Team.None, "There is no winning team");

        uint256 totalWinnings = 0;
        uint256[] memory userBetIds = betsByBettor[msg.sender];

        for (uint i = 0; i < userBetIds.length; i++) {
            Bet storage userBet = bets[userBetIds[i]];
            if (!userBet.claimed && userBet.team == winningTeam) {
                userBet.claimed = true;
                uint256 winningPool = (winningTeam == Team.Home) ? totalHomeBets : totalAwayBets;
                // Payout is proportional to their stake in the winning pool
                uint256 payout = (userBet.amount * totalPrizePool) / winningPool;
                totalWinnings += payout;
            }
        }

        require(totalWinnings > 0, "No winnings to claim");
        
        payable(msg.sender).transfer(totalWinnings);
        emit WinningsClaimed(matchId, msg.sender, totalWinnings);
    }
    
    /**
     * @notice Allows users to reclaim their initial bet if the market is canceled (e.g., a tie).
     */
    function reclaimBetFromCanceledMarket() external {
        require(status == MarketStatus.Canceled, "Market has not been canceled");

        uint256 totalReclaim = 0;
        uint256[] memory userBetIds = betsByBettor[msg.sender];
        
        for (uint i = 0; i < userBetIds.length; i++) {
            Bet storage userBet = bets[userBetIds[i]];
            if(!userBet.claimed) {
                userBet.claimed = true;
                totalReclaim += userBet.amount;
            }
        }

        require(totalReclaim > 0, "No funds to reclaim");
        payable(msg.sender).transfer(totalReclaim);
    }

    // --- Helper & ABI Hack ---

    /**
     * @notice A helper function to easily retrieve the ABI signature for the DataTransportObject struct.
     * @dev The off-chain script will use this function's ABI definition to generate the
     *      'abiSignature' string required for the Web2Json attestation request.
     * @param dto A DataTransportObject instance (can be empty, it's only for type inference).
     */
    function abiSignatureHack(DataTransportObject memory dto) public pure {}
}