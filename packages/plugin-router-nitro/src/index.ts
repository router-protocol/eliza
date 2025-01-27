import { Plugin } from "@elizaos/core";
import { executeSwapAction } from "./actions/executeSwap.ts";
import { swapConfirmAction } from "./actions/confirmSwap.ts";
import { WalletProvider, walletProvider } from "./providers/suiWalletProvider.ts";


export const nitroPlugin: Plugin = {
    name: "Nitro",
    description: "Nitro Plugin for Eliza",
    actions: [executeSwapAction, swapConfirmAction],
    evaluators: [],
    providers: [walletProvider],
};

export default nitroPlugin;

