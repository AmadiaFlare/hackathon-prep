import { formatUnits } from "ethers";
import { AnchorFeedConsumerInstance } from "../../typechain-types";

const AnchorFeedConsumer = artifacts.require("AnchorFeedConsumer");

// Manually generate feed ID (not recommended)
function getFeedId(category: string, name: string): string {
    const hexName = Buffer.from(name, 'utf8').toString('hex');

    const combined = category + hexName;

    const padded = combined.padEnd(42, '0');

    return `0x${padded}`;
}

async function main() {
    console.log("Deploying AnchorFeedConsumer contract...");

    const consumer: AnchorFeedConsumerInstance = await AnchorFeedConsumer.new();
    console.log(`AnchorFeedConsumer deployed to: ${consumer.address}`);

    // Generate the feed ID for FLR/USD (Category 01 for crypto)
    const feedId = getFeedId("01", "FLR/USD");
    console.log(`\nUsing Feed ID for FLR/USD: ${feedId}`);

    // --- Interact with the contract --- //

    // 1. Get Feeds History Size
    const historySize = await consumer.getFeedsHistorySize();
    console.log(`\nFeeds History Size: ${historySize.toString()}`);

    // 2. Get FTSO Protocol ID
    const protocolId = await consumer.getFtsoProtocolId();
    console.log(`FTSO Protocol ID: ${protocolId}`);

    try {
        // 3. Get the current feed
        console.log("\nFetching current feed for FLR/USD...");
        const currentFeed = await consumer.getCurrentFeed(feedId);
        console.log("Current Feed Data:", {
            votingRoundId: currentFeed.votingRoundId.toString(),
            value: formatUnits(currentFeed.value, Number(currentFeed.decimals)),
        });

    } catch (error) {
        console.error("Could not fetch feed data:", error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});