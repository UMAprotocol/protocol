import assert from "assert";
import { Provider, Block } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import { bridgePool, rateModelStore } from "../clients";
import { BigNumberish } from "./utils";
import { calculateRealizedLpFeePct } from "./feeCalculator";
import { parseAndReturnRateModelFromString } from "./rateModel";
import { exists } from "../utils";
import BlockFinder from "../blockFinder";

export default class LpFeeCalculator {
  private blockFinder: BlockFinder<Block>;
  constructor(private provider: Provider) {
    this.blockFinder = new BlockFinder<Block>(provider.getBlock.bind(provider));
  }
  async getLpFeePct(tokenAddress: string, bridgePoolAddress: string, amount: BigNumberish, timestamp?: number) {
    amount = BigNumber.from(amount);
    assert(amount.gt(0), "Amount must be greater than 0");

    const { blockFinder, provider } = this;

    const bridgePoolInstance = bridgePool.connect(bridgePoolAddress, provider);
    const rateModelStoreAddress = await rateModelStore.getAddress(await (await this.provider.getNetwork()).chainId);
    const rateModelStoreInstance = rateModelStore.connect(rateModelStoreAddress, provider);

    const targetBlock = exists(timestamp)
      ? await blockFinder.getBlockForTimestamp(timestamp)
      : await provider.getBlock("latest");
    assert(exists(targetBlock), "Unable to find target block for timestamp: " + timestamp || "latest");
    const blockTag = targetBlock.number;

    const [currentUt, nextUt, rateModelForBlockHeight] = await Promise.all([
      bridgePoolInstance.callStatic.liquidityUtilizationCurrent({ blockTag } as any),
      bridgePoolInstance.callStatic.liquidityUtilizationPostRelay(amount, { blockTag } as any),
      rateModelStoreInstance.callStatic.l1TokenRateModels(tokenAddress, { blockTag } as any),
    ]);

    // Parsing stringified rate model will error if the rate model doesn't contain exactly the expected keys or isn't
    // a JSON object.
    const rateModel = parseAndReturnRateModelFromString(rateModelForBlockHeight);

    return calculateRealizedLpFeePct(rateModel, currentUt, nextUt);
  }
}
