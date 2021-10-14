// A thick client for getting information about insured bridge L1 & L2 information. Simply acts to fetch information
// from the respective chains and return it to client implementors.

import { getAbi } from "@uma/contracts-node";
import type { BridgeDepositBoxWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import type { Logger } from "winston";

export interface Deposit {
  chainId: number;
  depositId: number;
  depositHash: string;
  l1Recipient: string;
  l2Sender: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  quoteTimestamp: number;
  depositContract: string;
}

export class InsuredBridgeL2Client {
  public bridgeDepositBox: BridgeDepositBoxWeb3;

  private deposits: { [key: string]: Deposit } = {}; // DepositId=>Deposit

  private firstBlockToSearch: number;

  constructor(
    private readonly logger: Logger,
    readonly l2Web3: Web3,
    readonly bridgeDepositAddress: string,
    readonly chainId: number = 0,
    readonly startingBlockNumber: number = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    this.bridgeDepositBox = (new l2Web3.eth.Contract(
      getAbi("BridgeDepositBox"),
      bridgeDepositAddress
    ) as unknown) as BridgeDepositBoxWeb3;

    this.firstBlockToSearch = startingBlockNumber;
  }

  getAllDeposits() {
    return Object.keys(this.deposits).map((depositId: string) => this.deposits[depositId]);
  }

  getDepositByID(depositId: string | number) {
    return this.deposits[depositId.toString()];
  }

  // TODO: consider adding a method that limits how far back the deposits will be returned from. In this implementation
  // we might hit some performance issues when returning a lot of bridging actions

  async update(): Promise<void> {
    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: this.endingBlockNumber || (await this.l2Web3.eth.getBlockNumber()),
    };
    // TODO: update this state retrieval to include looking for L2 liquidity in the deposit box that can be sent over
    // the bridge. This should consider the minimumBridgingDelay and the lastBridgeTime for a respective L2Token.
    const [fundsDepositedEvents] = await Promise.all([
      this.bridgeDepositBox.getPastEvents("FundsDeposited", blockSearchConfig),
    ]);

    for (const fundsDepositedEvent of fundsDepositedEvents) {
      const depositData = {
        chainId: Number(fundsDepositedEvent.returnValues.chainId),
        depositId: Number(fundsDepositedEvent.returnValues.depositId),
        depositHash: "", // Filled in after initialization of the remaining variables.
        l1Recipient: fundsDepositedEvent.returnValues.l1Recipient,
        l2Sender: fundsDepositedEvent.returnValues.l2Sender,
        l1Token: fundsDepositedEvent.returnValues.l1Token,
        amount: fundsDepositedEvent.returnValues.amount,
        slowRelayFeePct: fundsDepositedEvent.returnValues.slowRelayFeePct,
        instantRelayFeePct: fundsDepositedEvent.returnValues.instantRelayFeePct,
        quoteTimestamp: Number(fundsDepositedEvent.returnValues.quoteTimestamp),
        depositContract: fundsDepositedEvent.address,
      };
      depositData.depositHash = this.generateDepositHash(depositData);
      this.deposits[fundsDepositedEvent.returnValues.depositId] = depositData;
    }

    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({
      at: "InsuredBridgeL2Client",
      message: "Insured bridge l2 client updated",
      chainId: this.chainId,
    });
  }

  generateDepositHash = (depositData: Deposit): string => {
    const depositDataAbiEncoded = this.l2Web3.eth.abi.encodeParameters(
      ["uint256", "uint64", "address", "address", "address", "uint256", "uint64", "uint64", "uint32"],
      [
        depositData.chainId,
        depositData.depositId,
        depositData.l1Recipient,
        depositData.l2Sender,
        depositData.l1Token,
        depositData.amount,
        depositData.slowRelayFeePct,
        depositData.instantRelayFeePct,
        depositData.quoteTimestamp,
      ]
    );
    const depositHash = this.l2Web3.utils.soliditySha3(depositDataAbiEncoded);
    if (depositHash == "" || depositHash == null) throw new Error("Bad deposit hash");
    return depositHash;
  };
}
