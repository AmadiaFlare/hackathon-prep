import hre, { artifacts, run } from 'hardhat';
import { FTSOPriceGuesserInstance } from '../../typechain-types';
import { getDALayerUrl } from '../../utils/network';

// --- Configuration ---
const FEED_ID_TO_VERIFY = '0x01464c522f55534400000000000000000000000000'; // FLR/USD
const ROUND_RETRY_ATTEMPTS = 5;
const TARGET_PRICE_USD_STRING = '0.025';
const GUESSER_PREDICTION = 1;

const FTSOPriceGuesser = artifacts.require('FTSOPriceGuesser');

/**
 * Fetches the latest successful voting round from the DA Layer.
 */
async function getLatestVotingRound(daLayerUrl: string): Promise<number> {
  console.log('Fetching latest voting round...');
  try {
    const response = await fetch(`${daLayerUrl}/api/v0/fsp/latest-voting-round`);
    if (!response.ok) {
      throw new Error(`Failed to fetch latest round: ${response.statusText}`);
    }
    const data = await response.json();
    console.log('DA Layer Response:', JSON.stringify(data, null, 2));
    const latestRoundId = data.voting_round_id;
    console.log(`Latest FTSO round is: ${latestRoundId}`);
    // Fetch the previous round to ensure it has been finalized.
    return latestRoundId - 1;
  } catch (error) {
    console.error('Error fetching latest voting round:', (error as Error).message);
    throw error;
  }
}

/**
 * Fetches the anchor feed proof for a given voting round ID, with retries for older rounds.
 */
async function getAnchorFeedProof(
  daLayerUrl: string,
  startRoundId: number
): Promise<any | null> {
  for (let i = 0; i < ROUND_RETRY_ATTEMPTS; i++) {
    const votingRoundId = startRoundId - i;
    console.log(
      `\nAttempting to fetch proof for voting round: ${votingRoundId}`
    );
    try {
      const response = await fetch(
        `${daLayerUrl}/api/v0/ftso/anchor-feeds-with-proof?voting_round_id=${votingRoundId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feed_ids: [FEED_ID_TO_VERIFY] }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          console.log(`Successfully fetched proof for round ${votingRoundId}.`);
          return data[0];
        }
      } else if (response.status === 500) {
        console.log(`Round ${votingRoundId} not yet available. Trying older round...`);
      } else {
        throw new Error(`Server responded with status: ${response.status}`);
      }
    } catch (error) {
      console.error(
        `Error fetching proof for round ${votingRoundId}:`,
        (error as Error).message
      );
    }
  }
  console.error(`Failed to fetch proof after ${ROUND_RETRY_ATTEMPTS} attempts.`);
  return null;
}

/**
 * Deploys and verifies the FTSOPriceGuesser contract.
 */
async function deployContract(): Promise<FTSOPriceGuesserInstance> {
  console.log('\n--- Deploying FTSOPriceGuesser Contract ---');
  const priceGuesser = await FTSOPriceGuesser.new();
  console.log(`Contract deployed at: ${priceGuesser.address}`);

  try {
    await run('verify:verify', {
      address: priceGuesser.address,
      constructorArguments: [],
      contract: "contracts/ftso/FTSOPriceGuesser.sol:FTSOPriceGuesser"
    });
    console.log('Contract verified successfully.');
  } catch (e: any) {
    if (e.message.toLowerCase().includes('already verified')) {
      console.log('Contract is already verified.');
    } else {
      console.log(`Contract verification failed: ${e.message}`);
    }
  }

  return priceGuesser;
}

/**
 * Submits a price guess to the deployed contract.
 */
async function makeGuessOnContract(
  contract: FTSOPriceGuesserInstance,
  guesserAddress: string
): Promise<void> {
  console.log('\n--- Making a Guess ---');
  const targetPrice = hre.ethers.parseUnits(TARGET_PRICE_USD_STRING, 5);
  const predictionText = GUESSER_PREDICTION === 1 ? 'ABOVE' : 'BELOW';
  console.log(
    `Submitting guess that FLR/USD will be ${predictionText} $${TARGET_PRICE_USD_STRING}`
  );
  
  const guessTx = await contract.makeGuess(targetPrice, GUESSER_PREDICTION, { from: guesserAddress });
  console.log('Guess successfully submitted. Transaction:', guessTx.tx);
}

/**
 * Resolves a user's guess on the contract using the fetched proof.
 */
async function resolveGuessOnContract(
  contract: FTSOPriceGuesserInstance,
  guesserAddress: string,
  proofData: any
): Promise<void> {
  console.log('\n--- Resolving the Guess ---');

  const resolveTx = await contract.resolveGuess(guesserAddress, proofData, { from: guesserAddress });
  console.log('Guess successfully resolved. Transaction:', resolveTx.tx);
}

/**
 * Verifies the final state of the guess on-chain.
 */
async function verifyResult(
    contract: FTSOPriceGuesserInstance,
    guesserAddress: string,
    proofData: any
): Promise<void> {
    console.log('\n--- Final Result ---');
    const finalGuessState = await contract.guesses(guesserAddress);
  
    if (finalGuessState.wasCorrect) {
      console.log('✅ The guess was correct!');
    } else {
      console.log('❌ The guess was incorrect.');
    }
    
    console.log(
      `Verified Price: $${hre.ethers.formatUnits(proofData.body.value, 5)}`
    );
    console.log(`Target Price:   $${TARGET_PRICE_USD_STRING}`);
  }

/**
 * Main execution function that orchestrates the workflow.
 */
async function main() {
  const [guesser] = await hre.ethers.getSigners();
  const daLayerUrl = getDALayerUrl(hre.network.name);

  console.log(`Guesser Address: ${guesser.address}`);
  console.log(`DA Layer URL: ${daLayerUrl}`);

  try {
    const priceGuesser = await deployContract();
    await makeGuessOnContract(priceGuesser, guesser.address);
    const votingRoundId = await getLatestVotingRound(daLayerUrl);
    const proofData = await getAnchorFeedProof(daLayerUrl, votingRoundId);

    if (!proofData) {
      throw new Error('Could not retrieve a valid proof from the DA Layer.');
    }

    await resolveGuessOnContract(priceGuesser, guesser.address, proofData);
    await verifyResult(priceGuesser, guesser.address, proofData);
    
  } catch (error: any) {
    console.error('\n❌ Script failed to execute:', error.reason || error.message);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});