import { run } from "hardhat";
import { GenerativeNFTInstance } from "../typechain-types";

const GenerativeNFT = artifacts.require("GenerativeNFT");

// yarn hardhat run scripts/deploy_generative_nft.ts --network coston2

async function deployAndVerify() {
    console.log("Deploying GenerativeNFT...");
    const generativeNFT: GenerativeNFTInstance = await GenerativeNFT.new();
    console.log("GenerativeNFT deployed to", generativeNFT.address);

    try {
        console.log("Verifying contract on Etherscan...");
        await run("verify:verify", {
            address: generativeNFT.address,
            constructorArguments: [],
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
