import winston from "winston";

import BridgeAdapterInterface from "../../src/canonical-bridge-adapters/BridgeAdapterInterface";

import Web3 from "web3";
import type { TransactionType } from "@uma/common";

export class BridgeAdapterMock implements BridgeAdapterInterface {
  finalizationTransaction: TransactionType | null;
  constructor(readonly logger: winston.Logger, readonly l1Web3: Web3, readonly l2Web3: Web3) {
    this.finalizationTransaction = null;
  }

  async initialize() {
    return;
  }

  async constructCrossDomainFinalizationTransaction(
    l2TransactionHash: string
  ): Promise<{ l2TransactionHash: string; finalizationTransaction: TransactionType | null }> {
    return { l2TransactionHash, finalizationTransaction: this.finalizationTransaction };
  }

  setFinalizationTransaction(finalizationTransaction: TransactionType | null): void {
    this.finalizationTransaction = finalizationTransaction;
  }
}
