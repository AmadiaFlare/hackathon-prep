import { web3 } from "hardhat";
import { marketAddress, matchId } from "./config";
import { SportsMarketInstance } from "../../typechain-types";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "../utils/fdc";

const SportsMarket = artifacts.require("SportsMarket");

// Environment variables for FDC
const { WEB2JSON_VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

// Command to run this script:
// yarn hardhat run scripts/sportsBetting/resolveMarket.ts --network coston2

// --- FDC Request Configuration ---
const attestationTypeBase = "Web2Json";
const sourceIdBase = "PublicWeb2";

// JQ filter to parse the API response and format it for our DataTransportObject struct
// Per the logic of the sportsDapp, if the game has not ended yet this jq will be invalid as it will attempt to convert a null value to a number
const postProcessJq = `{matchId: .events[0].idEvent | tonumber, homeScore: .events[0].intHomeScore | tonumber, awayScore: .events[0].intAwayScore | tonumber, status: .events[0].strStatus}`;
const abiSignature = `{
          "components": [
            {
              "internalType": "uint256",
              "name": "matchId",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "homeScore",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "awayScore",
              "type": "uint256"
            },
            {
              "internalType": "string",
              "name": "status",
              "type": "string"
            }
          ],
          "internalType": "struct DataTransportObject",
          "name": "dto",
          "type": "tuple"
        }`;

async function prepareAttestationRequest() {
    if (!WEB2JSON_VERIFIER_URL_TESTNET || !VERIFIER_API_KEY_TESTNET) {
        throw new Error("Missing required environment variables for FDC request.");
    }
    
    const requestBody = {
        url: `https://www.thesportsdb.com/api/v1/json/123/lookupevent.php?id=${matchId}`,
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "{}",
        postProcessJq: postProcessJq,
        abiSignature: abiSignature,
    };

    const url = `${WEB2JSON_VERIFIER_URL_TESTNET}Web2Json/prepareRequest`;
    return await prepareAttestationRequestBase(url, VERIFIER_API_KEY_TESTNET, attestationTypeBase, sourceIdBase, requestBody);
}

async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number) {
    if (!COSTON2_DA_LAYER_URL) throw new Error("COSTON2_DA_LAYER_URL is not set.");
    const url = `${COSTON2_DA_LAYER_URL}api/v1/fdc/proof-by-request-round-raw`;
    console.log("Using DA Layer URL:", url, "\n");
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

async function main() {
    const sportsMarket: SportsMarketInstance = await SportsMarket.at(marketAddress);

    console.log("--- Step 1: Preparing Attestation Request ---");
    const preparedData = await prepareAttestationRequest();
    console.log("Prepared Request Data:", preparedData, "\n");

    const abiEncodedRequest = preparedData.abiEncodedRequest;

    console.log("--- Step 2: Submitting Attestation Request to FDC Hub ---");
    const roundId = await submitAttestationRequest(abiEncodedRequest);

    console.log("--- Step 3: Retrieving Proof from DA Layer ---");
    const proof = await retrieveDataAndProof(abiEncodedRequest, roundId);

    console.log("--- Step 4: Resolving Market On-Chain ---");
    
    // Decode the response to display it before sending to the contract
    const IWeb2JsonVerification = artifacts.require("IWeb2JsonVerification");
    const responseType = IWeb2JsonVerification.abi.find(f => f.name === 'verifyJsonApi').inputs[0].components[1];
    const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex);
    
    console.log("Decoded Data from Proof:", {
        matchId: decodedResponse.matchId.toString(),
        homeScore: decodedResponse.homeScore.toString(),
        awayScore: decodedResponse.awayScore.toString(),
        status: decodedResponse.status,
    }, "\n");

    const tx = await sportsMarket.resolveMarket({
        merkleProof: proof.proof,
        data: decodedResponse,
    });
    console.log(`Market resolved! Transaction hash: ${tx.tx}`);
    
    const winningTeam = (await sportsMarket.winningTeam()).toNumber(); // 1 for Home, 2 for Away
    const status = await sportsMarket.status();

    console.log("\n--- Market Resolution Complete ---");
    if (status.toNumber() === 2 /* Resolved */) {
      const winnerName = winningTeam === 1 ? await sportsMarket.homeTeamName() : await sportsMarket.awayTeamName();
      console.log(`Winning Team: ${winnerName} (Team ID: ${winningTeam})`);
    } else if (status.toNumber() === 3 /* Canceled */) {
      console.log("Market was canceled (likely a tie). Bets can be reclaimed.");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });