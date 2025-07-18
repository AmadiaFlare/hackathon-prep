import { run, web3 } from "hardhat";
import { UniswapSwapMonitorInstance } from "../../typechain-types";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "../utils/fdc";

const UniswapSwapMonitor = artifacts.require("UniswapSwapMonitor");

const { VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

// Command to run:
// yarn hardhat run scripts/fdcExample/verifyUniswapSwap.ts --network coston2

// 1. Identify Transaction: A Sepolia transaction with a single Uniswap V3 Swap event. -- change when running executeSwap() for a specific tx you create
const transactionHash = "0x7c42f1e908cdb28c5c36812f6eb59cc9711f0b24231a0f8c0135704be7c2cde0";

// Configuration constants for FDC
const attestationTypeBase = "EVMTransaction";
const sourceIdBase = "testETH"; // Corresponds to Sepolia testnet
const verifierUrlBase = VERIFIER_URL_TESTNET;
const urlTypeBase = "eth";

// 2. Prepare Attestation Request: Encode the transaction data for the FDC.
async function prepareAttestationRequest(transactionHash: string) {
    const requestBody = {
        transactionHash: transactionHash,
        requiredConfirmations: "1",
        provideInput: true,
        listEvents: true,
        logIndices: [],
    };

    const url = `${verifierUrlBase}verifier/${urlTypeBase}/EVMTransaction/prepareRequest`;
    const apiKey = VERIFIER_API_KEY_TESTNET;

    return await prepareAttestationRequestBase(url, apiKey, attestationTypeBase, sourceIdBase, requestBody);
}

// 4. Retrieve Data and Proof: Fetch the proof from the Data Availability layer after finalization.
async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number) {
    const url = `${COSTON2_DA_LAYER_URL}api/v1/fdc/proof-by-request-round-raw`;
    console.log("Querying DA Layer URL:", url, "\n");
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

// Deploy the UniswapSwapMonitor contract.
async function deployAndVerifyContract(): Promise<UniswapSwapMonitorInstance> {
    const monitor: UniswapSwapMonitorInstance = await UniswapSwapMonitor.new();
    try {
        await run("verify:verify", {
            address: monitor.address,
            constructorArguments: [],
        });
    } catch (e: any) {
        console.log("Contract verification failed:", e.message);
    }
    console.log("UniswapSwapMonitor deployed to:", monitor.address, "\n");
    return monitor;
}

// 5. Verify and Use Data: Send the proof to the contract to verify and extract swap data.
async function interactWithContract(monitor: UniswapSwapMonitorInstance, proof: any) {
    console.log("Submitting proof to the smart contract...");

    // Use an artifact to get the correct response type for decoding
    const IEVMTransactionVerification = await artifacts.require("IEVMTransactionVerification");
    const responseType = IEVMTransactionVerification._json.abi[0].inputs[0].components[1];

    const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex);
    
    console.log("--- Decoded FDC Response ---");
    console.log(decodedResponse);
    console.log("----------------------------");

    console.log("--- All Events in Transaction ---");
    // The events are nested inside the 'responseBody' object.
    decodedResponse.responseBody.events.forEach((event: any, index: number) => {
        console.log(`  Event ${index}:`);
        console.log(`    Emitter: ${event.emitterAddress}`);
        console.log(`    Topics: ${JSON.stringify(event.topics, null, 2)}`);
    });
    console.log("---------------------------------");

    const tx = await monitor.collectSwapEvents({
        merkleProof: proof.proof,
        data: decodedResponse,
    });
    console.log("Transaction successful. TX Hash:", tx.tx, "\n");

    const swapEventCount = (await monitor.getSwapEvents()).length;
    console.log(`Found ${swapEventCount} Swap event(s) in the transaction.`);

    if (swapEventCount > 0) {
        const firstSwapEvent = await monitor.swapEvents(0);
        console.log("--- Decoded Swap Event Data ---");
        console.log("  Sender:    ", firstSwapEvent.sender);
        console.log("  Recipient: ", firstSwapEvent.recipient);
        console.log("  Amount 0:  ", firstSwapEvent.amount0.toString());
        console.log("  Amount 1:  ", firstSwapEvent.amount1.toString());
        console.log("  Tick:      ", firstSwapEvent.tick.toString());
        console.log("-----------\n");
    }
}

async function main() {
    const data = await prepareAttestationRequest(transactionHash);
    console.log("Prepared Attestation Request:", data, "\n");

    const abiEncodedRequest = data.abiEncodedRequest;
    
    // 3. Submit Attestation Request: Initiate the consensus protocol.
    const roundId = await submitAttestationRequest(abiEncodedRequest);

    const proof = await retrieveDataAndProof(abiEncodedRequest, roundId);

    const monitor = await deployAndVerifyContract();
    
    // 5. Interact with the contract to verify the proof and decode the event.
    await interactWithContract(monitor, proof);
}

main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});
