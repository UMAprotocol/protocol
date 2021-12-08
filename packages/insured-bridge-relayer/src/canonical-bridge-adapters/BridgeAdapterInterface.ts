import type { TransactionType } from "@uma/common";

export default interface ExchangeAdapterInterface {
  initialize(): void;
  constructCrossDomainFinalizationTransaction(
    transactionHash: string
  ): Promise<{ l2TransactionHash: string; finalizationTransaction: TransactionType | null }>;
}
