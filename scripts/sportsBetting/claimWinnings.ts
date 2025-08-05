import { ethers } from "hardhat";
import { marketAddress } from "./config";
import { SportsMarketInstance } from "../../typechain-types";

const SportsMarket = artifacts.require("SportsMarket");

// Command to run this script:
// yarn hardhat run scripts/sportsBetting/claimWinnings.ts --network coston2

async function main() {
    const [bettor1, bettor2] = await ethers.getSigners();
    const bettors = [bettor1, bettor2];

    const sportsMarket: SportsMarketInstance = await SportsMarket.at(marketAddress);
    console.log(`Interacting with SportsMarket at: ${sportsMarket.address}`);

    const marketStatus = (await sportsMarket.status()).toNumber();
    if (marketStatus !== 2) { // 2 is 'Resolved'
        console.log("Market is not resolved yet. Current status:", marketStatus);
        return;
    }

    const winningTeam = (await sportsMarket.winningTeam()).toNumber();
    const winningTeamName = winningTeam === 1 ? await sportsMarket.homeTeamName() : await sportsMarket.awayTeamName();
    console.log(`The winning team is: ${winningTeamName} (Team ID: ${winningTeam})`);

    for (const bettor of bettors) {
        console.log(`\nChecking winnings for bettor: ${bettor.address}`);
        const balanceBefore = await ethers.provider.getBalance(bettor.address);
        
        try {
            const tx = await sportsMarket.claimWinnings({ from: bettor.address });
            const receipt = await web3.eth.getTransactionReceipt(tx.tx);
            const gasUsed = BigInt(receipt.gasUsed);
            const gasPrice = BigInt(tx.receipt.effectiveGasPrice);
            const gasCost = gasUsed * gasPrice;

            console.log(`Claim successful! Transaction hash: ${tx.tx}`);
            const balanceAfter = await ethers.provider.getBalance(bettor.address);
            const winnings = balanceAfter - balanceBefore + gasCost;
            console.log(`Bettor ${bettor.address} claimed ${ethers.formatEther(winnings)} CFLR`);

        } catch (e: any) {
            if (e.message.includes("No winnings to claim")) {
                console.log("Bettor did not win, no winnings to claim.");
            } else {
                console.error("An error occurred during claim:", e.message);
            }
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });