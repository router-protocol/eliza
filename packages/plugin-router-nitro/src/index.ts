import { Plugin } from "@elizaos/core";
import { executeSwapAction } from "./actions/executeSwap.ts";
import { swapConfirmAction } from "./actions/confirmSwap.ts";


export const nitroPlugin: Plugin = {
    name: "Nitro",
    description: "Nitro Plugin for Eliza",
    actions: [executeSwapAction, swapConfirmAction],
    evaluators: [],
    providers: [],
};

export default nitroPlugin;
