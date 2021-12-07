import assert from "assert";
import { Provider, Block } from "@ethersproject/providers";
import { ethers, BigNumber } from "ethers";
import { bridgePool } from "../clients";
import { RATE_MODELS } from "./constants";
import { BigNumberish } from "./utils";
import { calculateRealizedLpFeePct } from "./feeCalculator";
import { exists } from "../utils";
import BlockFinder from "../blockFinder";

export default class LpFeeCalculator {
  private blockFinder: BlockFinder<Block>;
  constructor(private provider: Provider) {
    this.blockFinder = new BlockFinder<Block>(provider.getBlock.bind(provider));
  }
  async getLpFeePct(tokenAddress: string, bridgePoolAddress: string, amount: BigNumberish, timestamp?: number) {
    const rateModel = RATE_MODELS[ethers.utils.getAddress(tokenAddress)];
    assert(rateModel, "No rate model for token: " + tokenAddress);

    amount = BigNumber.from(amount);
    assert(amount.gt(0), "Amount must be greater than 0");

    const { blockFinder, provider } = this;

    const bridgePoolInstance = bridgePool.connect(bridgePoolAddress, provider);

    const targetBlock = exists(timestamp)
      ? await blockFinder.getBlockForTimestamp(timestamp)
      : await provider.getBlock("latest");
    assert(exists(targetBlock), "Unable to find target block for timestamp: " + timestamp || "latest");
    const blockTag = targetBlock.number;

    const [currentUt, nextUt] = await Promise.all([
      bridgePoolInstance.callStatic.liquidityUtilizationCurrent({ blockTag } as any),
      bridgePoolInstance.callStatic.liquidityUtilizationPostRelay(amount, { blockTag } as any),
    ]);
    return calculateRealizedLpFeePct(rateModel, currentUt, nextUt);
  }
}
