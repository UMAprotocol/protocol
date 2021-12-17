import winston from "winston";

import Web3 from "web3";

import BridgeAdapterInterface from "./BridgeAdapterInterface";
import { ArbitrumBridgeAdapter } from "./ArbitrumBridgeAdapter";

export function createBridgeAdapter(logger: winston.Logger, l1Web3: Web3, l2Web3: Web3): BridgeAdapterInterface {
  // TODO: add switching logic based on chainID when we have multiple L2adapters that we support.
  return new ArbitrumBridgeAdapter(logger, l1Web3, l2Web3);
}
