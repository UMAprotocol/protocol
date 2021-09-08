// A thick client for getting information about insured bridge L1 & L2 information. Simply acts to fetch information
// from the respective chains and return it to client implementors.

import { Abi } from "../types";
import type { OVMBridgeDepositBoxWeb3 } from "@uma/contracts-node";
import Web3 from "web3";
import type { Logger } from "winston";

export interface Deposit {
  depositId: number;
  timestamp: number;
  sender: string;
  recipient: string;
  l1Token: string;
  amount: string;
  slowRelayFeePct: string;
  instantRelayFeePct: string;
  quoteTimestamp: number;
}

export class InsuredBridgeL2Client {
  public bridgeDepositBox: OVMBridgeDepositBoxWeb3;

  private deposits: { [key: string]: Deposit } = {}; // DepositId=>Deposit

  private firstBlockToSearch: number;

  constructor(
    private readonly logger: Logger,
    readonly bridgeDepositBoxAbi: Abi,
    readonly l2Web3: Web3,
    readonly bridgeDepositAddress: string,
    readonly startingBlockNumber: number = 0,
    readonly endingBlockNumber: number | null = null
  ) {
    this.bridgeDepositBox = (new l2Web3.eth.Contract(
      bridgeDepositBoxAbi,
      bridgeDepositAddress
    ) as unknown) as InsuredBridgeL2Client["bridgeDepositBox"];

    this.firstBlockToSearch = startingBlockNumber;
  }

  getAllDeposits() {
    return Object.keys(this.deposits).map((depositId: string) => this.deposits[depositId]);
  }

  getDepositByID(depositId: string | number) {
    return this.deposits[depositId.toString()];
  }

  async update(): Promise<void> {
    // Define a config to bound the queries by.
    const blockSearchConfig = {
      fromBlock: this.firstBlockToSearch,
      toBlock: this.endingBlockNumber || (await this.l2Web3.eth.getBlockNumber()),
    };
    // TODO: update this state retrieval to include looking for L2 liquidity in the deposit box that can be sent over
    // the bridge. This should consider the minimumBridgingDelay and the lastBridgeTime for a respective L2Token.
    const [depositRelayedEvents] = await Promise.all([
      this.bridgeDepositBox.getPastEvents("FundsDeposited", blockSearchConfig),
    ]);

    for (const depositRelayedEvent of depositRelayedEvents) {
      this.deposits[depositRelayedEvent.returnValues.depositId] = {
        depositId: Number(depositRelayedEvent.returnValues.depositId),
        timestamp: Number(depositRelayedEvent.returnValues.timestamp),
        sender: depositRelayedEvent.returnValues.sender,
        recipient: depositRelayedEvent.returnValues.recipient,
        l1Token: depositRelayedEvent.returnValues.l1Token,
        amount: depositRelayedEvent.returnValues.amount,
        slowRelayFeePct: depositRelayedEvent.returnValues.slowRelayFeePct,
        instantRelayFeePct: depositRelayedEvent.returnValues.instantRelayFeePct,
        quoteTimestamp: Number(depositRelayedEvent.returnValues.quoteTimestamp),
      };
    }

    this.firstBlockToSearch = blockSearchConfig.toBlock + 1;

    this.logger.debug({
      at: "InsuredBridgeL2Client",
      message: "Insured bridge l2 client updated",
    });
  }
}
