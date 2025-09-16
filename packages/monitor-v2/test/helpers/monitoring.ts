import type { Provider } from "@ethersproject/abstract-provider";
import { BlockFinder, Multicall } from "@uma/sdk";
import { hre } from "../utils";

// OO v1/v2/Skinny types
import type {
  MonitoringParams as MonitoringParamsOO,
  BotModes as BotModesOO,
  OracleType,
} from "../../src/bot-oo/common";

// OO v3 types
import type { MonitoringParams as MonitoringParamsOOV3, BotModes as BotModesOOV3 } from "../../src/bot-oo-v3/common";
import type { BaseMonitoringParams } from "../../src/bot-utils/base";
import type { MonitoringParams as MonitoringParamsOOv3Cache } from "../../src/oo-v3-cache-syncer/common";

const ethers = hre.ethers;

export async function makeMonitoringParamsOO(
  oracleType: OracleType,
  contractAddress: string,
  botModes: Partial<BotModesOO> = {}
): Promise<MonitoringParamsOO> {
  const [signer] = await ethers.getSigners();
  const defaultBotModes: BotModesOO = {
    settleRequestsEnabled: false,
  } as BotModesOO;

  const mergedBotModes = { ...defaultBotModes, ...botModes } as BotModesOO;

  return {
    provider: (ethers.provider as unknown) as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    botModes: mergedBotModes,
    signer,
    timeLookback: 72 * 60 * 60,
    maxBlockLookBack: 1000,
    blockFinder: new BlockFinder(() => ({ number: 0, timestamp: 0 } as any)),
    pollingDelay: 0,
    gasLimitMultiplier: 150,
    oracleType,
    contractAddress,
  };
}

export async function makeMonitoringParamsOOV3(botModes: Partial<BotModesOOV3> = {}): Promise<MonitoringParamsOOV3> {
  const [signer] = await ethers.getSigners();
  const defaultBotModes: BotModesOOV3 = {
    settleAssertionsEnabled: false,
  } as BotModesOOV3;

  const mergedBotModes = { ...defaultBotModes, ...botModes } as BotModesOOV3;

  return {
    provider: (ethers.provider as unknown) as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    botModes: mergedBotModes,
    signer,
    timeLookback: 72 * 60 * 60,
    maxBlockLookBack: 1000,
    blockFinder: new BlockFinder(() => ({ number: 0, timestamp: 0 } as any)),
    pollingDelay: 0,
    gasLimitMultiplier: 150,
  } as MonitoringParamsOOV3;
}

export async function makeBaseMonitoringParams(): Promise<BaseMonitoringParams> {
  const [signer] = await ethers.getSigners();

  return {
    provider: (ethers.provider as unknown) as Provider,
    chainId: (await ethers.provider.getNetwork()).chainId,
    signer,
    timeLookback: 72 * 60 * 60,
    maxBlockLookBack: 1000,
    blockFinder: new BlockFinder(() => ({ number: 0, timestamp: 0 } as any)),
    pollingDelay: 0,
    gasLimitMultiplier: 150,
  };
}

export const makeMonitoringParamsOOv3Cache = async (multicallAddress: string): Promise<MonitoringParamsOOv3Cache> => {
  const base = await makeBaseMonitoringParams();

  const multicall = new Multicall(multicallAddress, base.provider);
  return {
    ...base,
    multicall,
    submitSyncTx: true,
  };
};
