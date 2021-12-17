import winston from "winston";

import Web3 from "web3";

import BridgeAdapterInterface from "./BridgeAdapterInterface";
import { ArbitrumBridgeAdapter } from "./ArbitrumBridgeAdapter";
import { OptimismBridgeAdapter } from "./OptimismBridgeAdapter";

export function createBridgeAdapter(
  logger: winston.Logger,
  l1Web3: Web3,
  l2Web3: Web3,
  l2ChainId: number
): BridgeAdapterInterface {
  if (l2ChainId == 42161) return new ArbitrumBridgeAdapter(logger, l1Web3, l2Web3);

  if (l2ChainId == 10 || l2ChainId == 288) return new OptimismBridgeAdapter(logger, l1Web3, l2Web3);

  throw new Error(`Unsupported l2ChainId ${l2ChainId}`);
}
