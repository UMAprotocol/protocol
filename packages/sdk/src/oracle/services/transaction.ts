import { Provider, TransactionReceipt } from "../types/ethers";

export class Transaction {
  constructor(private provider: Provider) {}
  async getReceipt(hash: string): Promise<TransactionReceipt> {
    return this.provider.getTransactionReceipt(hash);
  }
  async isConfirmed(hash: string, confirmations = 1): Promise<boolean | TransactionReceipt> {
    try {
      const receipt = await this.getReceipt(hash);
      if (receipt.confirmations >= confirmations) return receipt;
    } catch (err) {
      // do nothing
    }
    return false;
  }
}
