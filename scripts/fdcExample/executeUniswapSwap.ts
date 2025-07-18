import { ethers, BigNumberish } from "ethers";
import { CurrencyAmount, Token, TradeType, Percent } from "@uniswap/sdk-core";
import { Pool, Route, SwapRouter, Trade } from "@uniswap/v3-sdk";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as QuoterV2ABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json";
import { abi as SwapRouterABI } from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import { abi as ERC20_ABI} from "../../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";

const { SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY } = process.env;

// Uniswap V3 contract addresses on Sepolia
const FACTORY_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const SWAP_ROUTER_ADDRESS = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const QUOTER_ADDRESS = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3"; // QuoterV2

// Correct Token details for Sepolia
const WETH_TOKEN = new Token(11155111, "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", 18, "WETH", "Wrapped Ether");
const USDC_TOKEN = new Token(11155111, "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", 6, "USDC", "USD Coin");

async function getPoolImmutables(poolContract: ethers.Contract) {
    const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
        poolContract.factory(),
        poolContract.token0(),
        poolContract.token1(),
        poolContract.fee(),
        poolContract.tickSpacing(),
        poolContract.maxLiquidityPerTick(),
    ]);
    return { factory, token0, token1, fee: Number(fee), tickSpacing: Number(tickSpacing), maxLiquidityPerTick };
}

async function getPoolState(poolContract: ethers.Contract) {
    const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);
    const slot0 = {
        sqrtPriceX96: slot[0],
        tick: Number(slot[1]),
        observationIndex: Number(slot[2]),
        observationCardinality: Number(slot[3]),
        observationCardinalityNext: Number(slot[4]),
        feeProtocol: Number(slot[5]),
        unlocked: slot[6],
    };
    return { liquidity, slot0 };
}

export async function executeSwap(): Promise<string> {
    if (!SEPOLIA_RPC_URL || !SEPOLIA_PRIVATE_KEY) {
        throw new Error("Missing SEPOLIA_RPC_URL or SEPOLIA_PRIVATE_KEY in .env file");
    }

    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, provider);

    const factoryContract = new ethers.Contract(FACTORY_ADDRESS, ['function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'], provider);
    const poolAddress = await factoryContract.getPool(WETH_TOKEN.address, USDC_TOKEN.address, 3000);
    if (poolAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Pool does not exist for WETH/USDC with 0.3% fee on Sepolia');
    }
    console.log(`Using pool address: ${poolAddress}`);

    const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, provider);
    const [immutables, state] = await Promise.all([getPoolImmutables(poolContract), getPoolState(poolContract)]);

    const pool = new Pool(
        WETH_TOKEN,
        USDC_TOKEN,
        immutables.fee,
        state.slot0.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.slot0.tick
    );

    const amountIn = ethers.parseEther("0.01");

    const quoterContract = new ethers.Contract(QUOTER_ADDRESS, QuoterV2ABI, provider);
    const params = {
        tokenIn: WETH_TOKEN.address,
        tokenOut: USDC_TOKEN.address,
        fee: pool.fee,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0
    };

    const quotedOutput = await quoterContract.quoteExactInputSingle.staticCall(params);
    const quotedAmountOut = quotedOutput.amountOut;

    if (quotedAmountOut === 0n) {
        throw new Error("Quoted output amount is zero. Halting swap to prevent failure.");
    }
    console.log(`Quoted output amount: ${ethers.formatUnits(quotedAmountOut, 6)} USDC`);

    const trade = Trade.createUncheckedTrade({
        route: new Route([pool], WETH_TOKEN, USDC_TOKEN),
        inputAmount: CurrencyAmount.fromRawAmount(WETH_TOKEN, amountIn.toString()),
        outputAmount: CurrencyAmount.fromRawAmount(USDC_TOKEN, quotedAmountOut.toString()),
        tradeType: TradeType.EXACT_INPUT,
    });

    const wethContract = new ethers.Contract(WETH_TOKEN.address, ERC20_ABI, wallet);
    const approvalTx = await wethContract.approve(SWAP_ROUTER_ADDRESS, amountIn);
    console.log("Approving WETH spend... Tx Hash:", approvalTx.hash);
    await approvalTx.wait();
    console.log("Approval confirmed.");

    const options = {
        slippageTolerance: new Percent(50, 10_000), // 0.5%
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes
        recipient: wallet.address,
    };

    const methodParameters = SwapRouter.swapCallParameters([trade], options);

    const feeData = await provider.getFeeData();
    const tx = {
        data: methodParameters.calldata,
        to: SWAP_ROUTER_ADDRESS,
        value: methodParameters.value,
        from: wallet.address,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        gasLimit: ethers.toBigInt(1000000) // Use BigInt for consistency
    };

    const swapTx = await wallet.sendTransaction(tx);
    await swapTx.wait();
    return swapTx.hash;
}

if (require.main === module) {
    executeSwap()
        .then((txHash) => {
            console.log("Swap executed successfully on Sepolia!");
            console.log("Transaction Hash:", txHash);
            process.exit(0);
        })
        .catch((error) => {
            console.error("Failed to execute swap:", error);
            process.exit(1);
        });
}