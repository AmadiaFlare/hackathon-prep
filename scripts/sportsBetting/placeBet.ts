import { ethers } from "hardhat";
import { marketAddress } from "./config";
import { SportsMarketInstance } from "../../typechain-types";

const SportsMarket = artifacts.require("SportsMarket");

// Command to run this script:
// yarn hardhat run scripts/sportsBetting/placeBets.ts --network coston2

// Could make frontend here to get users bet

async function main() {
    const [bettor1, bettor2] = await ethers.getSigners();
    console.log(`Using Bettor 1: ${bettor1.address}`);
    console.log(`Using Bettor 2: ${bettor2.address}`);

    const sportsMarket: SportsMarketInstance = await SportsMarket.at(marketAddress);
    console.log(`Interacting with SportsMarket at: ${sportsMarket.address}`);

    const homeTeamName = await sportsMarket.homeTeamName();
    const awayTeamName = await sportsMarket.awayTeamName();

    const betAmount1 = ethers.parseEther("0.1"); // 0.1 CFLR
    const betAmount2 = ethers.parseEther("0.2"); // 0.2 CFLR

    // Bettor 1 places a bet on the Home team (Team enum value is 1)
    console.log(`\nBettor 1 placing a bet of ${ethers.formatEther(betAmount1)} on ${homeTeamName}...`);
    const tx1 = await sportsMarket.placeBet(1, { from: bettor1.address, value: betAmount1.toString() });
    console.log(`Bet 1 placed! Transaction hash: ${tx1.tx}`);

    // Bettor 2 places a bet on the Away team (Team enum value is 2)
    console.log(`Bettor 2 placing a bet of ${ethers.formatEther(betAmount2)} on ${awayTeamName}...`);
    const tx2 = await sportsMarket.placeBet(2, { from: bettor2.address, value: betAmount2.toString() });
    console.log(`Bet 2 placed! Transaction hash: ${tx2.tx}`);

    // Log the state of the prize pool
    const totalPrizePool = await sportsMarket.totalPrizePool();
    const totalHomeBets = await sportsMarket.totalHomeBets();
    const totalAwayBets = await sportsMarket.totalAwayBets();

    console.log("\n--- Market State After Bets ---");
    console.log(`Total Prize Pool: ${ethers.formatEther(totalPrizePool.toString())} CFLR`);
    console.log(`Total Home Team Bets: ${ethers.formatEther(totalHomeBets.toString())} CFLR`);
    console.log(`Total Away Team Bets: ${ethers.formatEther(totalAwayBets.toString())} CFLR`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });