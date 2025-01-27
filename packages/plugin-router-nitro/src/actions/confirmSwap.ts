import {
    composeContext,
    elizaLogger,
    generateMessageResponse,
    generateObjectDeprecated,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State
} from "@elizaos/core";
import { swapTemplate } from "./swapTemplate.ts";
import { ChainUtils, fetchChains, fetchPathfinderQuote, fetchTokenConfig } from "./utils.ts";
import { validateRouterNitroConfig } from "../environment.ts";
import { checkAndSetAllowance, checkNativeTokenBalance, checkUserBalance, getSwapTransaction } from "./txns.ts";
import { ethers } from "ethers";
import { getBlockExplorerFromChainId, getRpcUrlFromChainId } from "./chains.ts";

export const swapConfirmAction = {
    name: "SWAP_CONFIRM",
    description: "Confirms and executes a cross-chain swap after user validation",
    validate: async (runtime: IAgentRuntime) => {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        _options: { [key: string]: unknown } = {},
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            // Retrieve the previous swap context
            const swapContext = composeContext({
                state,
                template: swapTemplate,
            });

            const content = await generateObjectDeprecated({
                runtime,
                context: swapContext,
                modelClass: ModelClass.LARGE,
            });

            const { fromChain, toChain, fromToken, toToken, amount, toAddress } = content;

            // Fetch chains and process swap details
            const apiResponse = await fetchChains();
            const chainUtils = new ChainUtils(apiResponse);
            const swapDetails = chainUtils.processChainSwap(fromChain, toChain);

            console.log("SWAP DETAILS", swapDetails);

            // let privateKey = runtime.getSetting("ROUTER_NITRO_EVM_PRIVATE_KEY");
            // if (!privateKey) {
            //     throw new Error("Private key is missing. Please set ROUTER_NITRO_EVM_PRIVATE_KEY in the environment settings.");
            // }
            // if(swapDetails.fromChainIdType == 'evm') {
            //     let privateKey = runtime.getSetting("ROUTER_NITRO_EVM_PRIVATE_KEY");
            //     let rpc = getRpcUrlFromChainId(swapDetails.fromChainId);
            //     let provider = new ethers.JsonRpcProvider(rpc);
            //     let wallet = new ethers.Wallet(privateKey, provider);
            //     let address = await wallet.getAddress();
            // }

            // Fetch token configurations
            const fromTokenConfig = await fetchTokenConfig(swapDetails.fromChainId, fromToken);
            console.log("FROM TOKEN CONFIG", fromTokenConfig);
            const toTokenConfig = await fetchTokenConfig(swapDetails.toChainId, toToken);
            console.log("TO TOKEN CONFIG", toTokenConfig);

            // Calculate amount in with decimals
            let amountIn = BigInt(Math.floor(Number(amount) * Math.pow(10, fromTokenConfig.decimals)));

            // Prepare Pathfinder quote parameters
            const pathfinderParams = {
                fromTokenAddress: fromTokenConfig.address,
                toTokenAddress: toTokenConfig.address,
                amount: (amountIn).toString(),
                fromTokenChainId: swapDetails.fromChainId,
                toTokenChainId: swapDetails.toChainId,
                partnerId: 127,
            };

            // Fetch Pathfinder quote
            const pathfinderResponse = await fetchPathfinderQuote(pathfinderParams);

            if (pathfinderResponse) {
                let destinationData = pathfinderResponse.destination;
                const amountOut = BigInt(destinationData.tokenAmount);
                const decimals = Math.pow(10, destinationData.asset.decimals);
                const normalizedAmountOut = Number(amountOut) / decimals;
                console.log(`Amount out: ${normalizedAmountOut} ${destinationData.asset.symbol}`);
                const quoteMessage = `Quote: ${normalizedAmountOut} ${destinationData.asset.symbol}`;

                callback?.({
                    text: quoteMessage,
                });


                // Check and set allowance
                //                 await checkAndSetAllowance(
                //                     wallet,
                //                     fromTokenConfig.address,
                //                     pathfinderResponse.allowanceTo,
                //                     amountIn
                //                 );

                //                 // Get swap transaction
                //                 const txResponse = await getSwapTransaction(pathfinderResponse, address, toAddress);

                //                 // Send transaction
                //                 const tx = await wallet.sendTransaction(txResponse.txn);

                //                 // Wait for transaction confirmation
                //                 const receipt = await tx.wait();

                //                 // Get block explorer URL
                //                 const blockExplorerUrl = getBlockExplorerFromChainId(swapDetails.fromChainId).url;

                //                 // Prepare transaction confirmation message
                //                 let confirmationMessage = `Swap completed successfully!
                // Sent ${amount} ${fromToken} from ${fromChain} to ${toToken} on ${toChain}
                // Received approximately ${normalizedAmountOut} ${toToken}
                // Transaction Hash: ${tx.hash}`;

                //                 if (blockExplorerUrl) {
                //                     confirmationMessage += `\nExplorer: ${blockExplorerUrl}/tx/${tx.hash}`;
                //                 }

                //                 // Log and callback
                //                 elizaLogger.log(confirmationMessage);
                //                 callback?.({
                //                     text: confirmationMessage
                //                 });

                return false;
            }

            return false;
        } catch (error) {
            elizaLogger.log(`Error in SWAP_CONFIRM action: ${error.message}`);
            callback?.({
                text: `Failed: ${error.message}`
            });
            return false;
        }
    },
    template: swapTemplate,
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "No",
                    action: "SWAP_CONFIRM"
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Provide the prompt again",
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Yes",
                    action: "SWAP_CONFIRM"
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Confirmed. Processing 1 ETH from Ethereum to Base...",
                }
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Confirm swap of 100 USDC from Polygon to Arbitrum",
                    action: "SWAP_CONFIRM"
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Confirmed. Processing 100 USDC from Polygon to Arbitrum...",
                }
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Yes, proceed with transferring 50 AAVE from Optimism to Ethereum",
                    action: "SWAP_CONFIRM"
                }
            },
            {
                user: "{{agent}}",
                content: {
                    text: "Confirmed. Processing 50 AAVE from Optimism to Ethereum...",
                }
            },
        ]],
    similes: ["CONTINUE_SWAP", "CONFIRM_SWAP", "PROCEED_SWAP"],

};
