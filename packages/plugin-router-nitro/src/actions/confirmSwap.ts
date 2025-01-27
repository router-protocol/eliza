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
import { walletProvider } from "../providers/suiWalletProvider.ts";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { parseAccount } from "../providers/suiUtils.ts";

type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

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
            // const suiWalletInfo = await walletProvider.get(runtime, message, state);
            // state.suiWalletInfo = suiWalletInfo;


            const { fromChain, toChain, fromToken, toToken, amount, toAddress } = content;

            // Fetch chains and process swap details
            const apiResponse = await fetchChains();
            const chainUtils = new ChainUtils(apiResponse);
            const swapDetails = chainUtils.processChainSwap(fromChain, toChain);

            console.log("SWAP DETAILS", swapDetails);

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

                if (swapDetails.fromChainIdType == 'evm') {
                    let privateKey = runtime.getSetting("ROUTER_NITRO_EVM_PRIVATE_KEY");
                    let rpc = getRpcUrlFromChainId(swapDetails.fromChainId);
                    let provider = new ethers.JsonRpcProvider(rpc);
                    let wallet = new ethers.Wallet(privateKey, provider);
                    let address = await wallet.getAddress();

                    if (fromTokenConfig.address.toLowerCase() == "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
                        const userBalance = await checkNativeTokenBalance(wallet, fromTokenConfig.decimals);
                        if (BigInt(userBalance) < amountIn) {
                            elizaLogger.log("Insufficient balance to perform the swap");
                            callback?.({ text: `Insufficient balance to perform the swap` });
                            return false;
                        }
                    }
                    else {
                        const userBalance = await checkUserBalance(wallet, fromTokenConfig.address, fromTokenConfig.decimals);
                        if (BigInt(userBalance) < amountIn) {
                            elizaLogger.log("Insufficient balance to perform the swap");
                            callback?.({ text: `Insufficient balance to perform the swap` });
                            return false;
                        }
                    }

                    await checkAndSetAllowance(
                        wallet,
                        fromTokenConfig.address,
                        pathfinderResponse.allowanceTo,
                        amountIn
                    );

                    const txResponse = await getSwapTransaction(pathfinderResponse, address, toAddress);

                    const tx = await wallet.sendTransaction(txResponse.txn);
                    await tx.wait();

                    try {
                        const blockExplorerUrl = getBlockExplorerFromChainId(swapDetails.fromChainId).url;
                        if (blockExplorerUrl) {
                            const txExplorerUrl = `${blockExplorerUrl}/tx/${tx.hash}`;
                            elizaLogger.log(`Transaction Explorer URL: ${txExplorerUrl}`);
                            callback?.({
                                text:
                                    "Swap completed successfully! Txn: " +
                                    txExplorerUrl,
                            });
                            return true;

                        } else {
                            callback?.({
                                text:
                                    "Swap completed successfully! Txn: " +
                                    tx.hash,
                            });
                        }
                    }
                    catch (error) {
                        console.log(`Transaction failed with error: ${error}`)
                    }

                    return true;
                }
                // else if(swapDetails.fromChainIdType == 'sui') {
                //     const suiAccount = parseAccount(runtime);
                //     const network = runtime.getSetting("ROUTER_NITRO_SUI_NETWORK");
                //     const suiClient = new SuiClient({
                //         url: getFullnodeUrl(network as SuiNetwork),
                //     });
                //     console.log("SUI CLIENT", suiClient);
                //     console.log("SUI ACCOUNT", suiAccount);
                // }
            }

            return false;
        } catch (error) {
            elizaLogger.log(`Error in SWAP_CONFIRM action: ${error.message}`);
            callback?.({
                text: `Swap confirmation failed: ${error.message}`
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
                    text: "Swap confirmed. Processing 1 ETH from Ethereum to Base...",
                }
            },
            //             {
            //                 user: "{{agent}}",
            //                 content: {
            //                     text: `Swap completed successfully!
            // Sent 1 ETH from Ethereum to Base
            // Received approximately 0.95 ETH
            // Transaction Hash: 0x4fed598033f0added272c3ddefd4d83a521634a738474400b27378db462a76ec`
            //                 }
            //             }
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
                    text: "Swap confirmed. Processing 100 USDC from Polygon to Arbitrum...",
                }
            },
            //             {
            //                 user: "{{agent}}",
            //                 content: {
            //                     text: `Swap completed successfully!
            // Sent 100 USDC from Polygon to Arbitrum
            // Received approximately 99.8 USDC
            // Transaction Hash: 0x3c72a5fe4d0278f2b46dbe765a5f5dbf2f78cbfdce3d0c2b8f11855969e9e173`
            //                 }
            //             }
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
                    text: "Swap confirmed. Processing 50 AAVE from Optimism to Ethereum...",
                }
            },
            //             {
            //                 user: "{{agent}}",
            //                 content: {
            //                     text: `Swap completed successfully!
            // Sent 50 AAVE from Optimism to Ethereum
            // Received approximately 49.5 AAVE
            // Transaction Hash: 0x720b46c95f7f819f5d7e1e8df6fd7d8be12b8d06312bb9d96ea85a45fc65079a"`
            //                 }
            //             }
        ]],
    similes: ["CONTINUE_SWAP", "CONFIRM_SWAP", "PROCEED_SWAP"],

};
