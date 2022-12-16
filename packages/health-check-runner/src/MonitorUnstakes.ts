import { Logger } from "@uma/financial-templates-lib";
import { Contract, providers } from "ethers";
import { MonitorConfig } from "./MonitorConfig";
import * as typechain from "@uma/contracts-node";

const logger = Logger;

try {
  logger.debug({ at: "UnstakeMonitor", message: "Starting Unstake monitoring 😟" });
  const config = new MonitorConfig(process.env);
  const provider = new providers.JsonRpcProvider(config.customNodeUrl);
  const votingV2Abi = typechain["VotingV2Ethers__factory"].abi;
  const votingV2 = new Contract(config.votingV2Address, votingV2Abi, provider);
} catch (error) {
  logger.error({
    at: "UnstakeMonitor",
    message: "UnstakeMonitor execution error🚨",
    error: typeof error === "string" ? new Error(error) : error,
  });
}
