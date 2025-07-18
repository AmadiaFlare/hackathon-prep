// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IEVMTransaction} from "@flarenetwork/flare-periphery-contracts/coston2/IEVMTransaction.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";

contract UniswapSwapMonitor {
    // Correct Uniswap V3 Pool address for the token pair on Coston2/Sepolia
    address public constant UNISWAP_V3_POOL = 0x56e7e33EF217fd8eBE111d97856b51A1d0A981D6;

    // Correct Swap event signature with parameter types only
    bytes32 public constant SWAP_EVENT_SIGNATURE = keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)");

    // Struct to store the relevant data from a Uniswap V3 Swap event
    struct SwapEventData {
        address sender;
        address recipient;
        int256 amount0;
        int256 amount1;
        uint160 sqrtPriceX96;
        uint128 liquidity;
        int24 tick;
    }

    // Array to store all collected swap events
    SwapEventData[] public swapEvents;



    /**
     * @notice Verifies an FDC proof for an EVM transaction and collects Swap events.
     * @param _transaction The FDC proof data for the transaction.
     */
    function collectSwapEvents(
        IEVMTransaction.Proof calldata _transaction
    ) external {
        // 1. FDC Verification: Ensure the transaction proof is valid.
        require(
            isEVMTransactionProofValid(_transaction),
            "Invalid transaction proof"
        );

        // 2. Business Logic: Iterate through events and decode Swap events.
        for (
            uint256 i = 0;
            i < _transaction.data.responseBody.events.length;
            i++
        ) {
            IEVMTransaction.Event memory _event = _transaction.data.responseBody.events[i];

            // Filter for events from the specific Uniswap V3 Pool
            if (_event.emitterAddress != UNISWAP_V3_POOL) {
                continue;
            }

            // Filter for the Swap event signature
            if (
                _event.topics.length != 3 || // Swap event has 2 indexed topics (sender, recipient)
                _event.topics[0] != SWAP_EVENT_SIGNATURE
            ) {
                continue;
            }

            // Decode the event data
            (int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick) = abi.decode(
                _event.data,
                (int256, int256, uint160, uint128, int24)
            );

            // Topics contain indexed parameters: sender, recipient
            address sender = address(uint160(uint256(_event.topics[1])));
            address recipient = address(uint160(uint256(_event.topics[2])));

            // Store the decoded event data
            swapEvents.push(
                SwapEventData({
                    sender: sender,
                    recipient: recipient,
                    amount0: amount0,
                    amount1: amount1,
                    sqrtPriceX96: sqrtPriceX96,
                    liquidity: liquidity,
                    tick: tick
                })
            );
        }
    }

    /**
     * @notice Returns all collected Swap events.
     */
    function getSwapEvents() external view returns (SwapEventData[] memory) {
        return swapEvents;
    }

    function isEVMTransactionProofValid(
        IEVMTransaction.Proof calldata transaction
    ) public view returns (bool) {
        IFdcVerification fdc = ContractRegistry.getFdcVerification();
        return fdc.verifyEVMTransaction(transaction);
    }
}