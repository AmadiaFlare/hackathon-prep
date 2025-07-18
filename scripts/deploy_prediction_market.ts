import { run, ethers } from "hardhat";
import { SimplePredictionMarketInstance } from "../typechain-types";

const SimplePredictionMarket = artifacts.require("SimplePredictionMarket");

// yarn hardhat run scripts/deploy_prediction_market.ts --network coston2

async function deployAndVerify() {
    // 1. Define Market Parameters
    const feedId = "0x01464c522f55534400000000000000000000000000"; // FLR/USD

    const targetPrice = "300000"; 

    // Set settlement for 1 hour from now
    const settlementTime = Math.floor(Date.now() / 1000) + 3600;

    const args: any[] = [feedId, targetPrice, settlementTime];

    // 2. Deploy the Contract
    console.log("Deploying SimplePredictionMarket with the following parameters:");
    console.log(`  Feed ID: ${feedId}`);
    console.log(`  Target Price: ${targetPrice}`);
    console.log(`  Settlement Time: ${new Date(settlementTime * 1000).toUTCString()}`);

    const predictionMarket: SimplePredictionMarketInstance = await SimplePredictionMarket.new(...args);
    console.log("\nSimplePredictionMarket deployed to", predictionMarket.address);

    // 3. Verify the Contract
    try {
        console.log("\nVerifying contract on block explorer...");
        await run("verify:verify", {
            address: predictionMarket.address,
            constructorArguments: args,
        });
        console.log("Contract verified successfully.");
    } catch (e: any) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("Already verified!");
        } else {
            console.log("Verification error:", e);
        }
    }
}

void deployAndVerify().then(() => {
    process.exit(0);
});
