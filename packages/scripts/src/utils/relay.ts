import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import "@nomiclabs/hardhat-ethers";
import { GovernorHubEthers, GovernorRootTunnelEthers, ParentMessengerBaseEthers } from "@uma/contracts-node";
import { TransactionDataDecoder } from "@uma/financial-templates-lib";
import { PopulatedTransaction, Signer } from "ethers";
import hre from "hardhat";

export interface ProposedTransaction {
  to: string;
  data: string;
  value: string;
}

export interface RelayTransaction {
  to: string;
  transaction: {
    name: string;
    params: {
      to: string;
      data?: string;
      chainId?: string;
      calls: { to: string; data: string }[];
    };
  };
}

export interface GovernanceMessage {
  targetAddress: string;
  tx: PopulatedTransaction;
}

export type GovernanceMessages = GovernanceMessage[];

export const relayGovernanceRootTunnelMessage = async (
  targetAddress: string,
  tx: PopulatedTransaction,
  governorRootTunnel: GovernorRootTunnelEthers
): Promise<{
  to: string;
  value: BigNumberish;
  data: BytesLike;
}> => {
  if (!tx.data) throw new Error("Transaction has no data");
  const relayGovernanceData = await governorRootTunnel.populateTransaction.relayGovernance(targetAddress, tx.data);
  console.log("RelayGovernanceData", relayGovernanceData);
  const relay = await governorRootTunnel.populateTransaction.relayGovernance(targetAddress, tx.data);
  const relayMessage = relay.data;
  if (!relayMessage) throw new Error("Relay message is empty");
  return { to: governorRootTunnel.address, value: 0, data: relayMessage };
};

export const relayGovernanceHubMessages = async (
  messages: GovernanceMessages,
  governorHub: GovernorHubEthers,
  chainId: BigNumberish
): Promise<
  {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[]
> => {
  const calls = messages.map((message) => {
    if (!message.tx.data) throw new Error("Transaction has no data");
    return { to: message.targetAddress, data: message.tx.data };
  });
  const relayGovernanceData = await governorHub.populateTransaction.relayGovernance(chainId, calls);
  const relayMessage = relayGovernanceData.data;
  if (!relayMessage) throw new Error("Relay message is empty");
  return [{ to: governorHub.address, value: 0, data: relayMessage }];
};

export const relayGovernanceMessages = async (
  messages: GovernanceMessages,
  l1Governor: GovernorHubEthers | GovernorRootTunnelEthers,
  chainId: number
): Promise<
  {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[]
> => {
  // The l1 governor for polygon is the GovernorRootTunnel and the l1 governor for the rest of l2's is the GovernorHub
  const isPolygon = chainId === 137;
  if (isPolygon) {
    const relayedMessages = [];
    for (const message of messages) {
      relayedMessages.push(
        await relayGovernanceRootTunnelMessage(
          message.targetAddress,
          message.tx,
          l1Governor as GovernorRootTunnelEthers
        )
      );
    }
    return relayedMessages;
  }
  return relayGovernanceHubMessages(messages, l1Governor as GovernorHubEthers, chainId);
};

export const fundArbitrumParentMessengerForRelays = async (
  arbitrumParentMessenger: ParentMessengerBaseEthers,
  from: Signer,
  totalNumberOfTransactions: BigNumberish
): Promise<void> => {
  // Sending a xchain transaction to Arbitrum will fail unless Arbitrum messenger has enough ETH to pay for message:
  const l1CallValue = await arbitrumParentMessenger.getL1CallValue();
  const cost = l1CallValue.mul(totalNumberOfTransactions);
  console.log(
    `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${hre.ethers.utils.formatEther(
      cost
    )} ETH balance.`
  );

  const apmBalance = await arbitrumParentMessenger.provider.getBalance(arbitrumParentMessenger.address);

  if (apmBalance.lt(cost)) {
    const amoutToSend = cost.sub(apmBalance);
    console.log(`Sending ${hre.ethers.utils.formatEther(amoutToSend)} ETH to Arbitrum_ParentMessenger`);

    const sendEthTxn = await from.sendTransaction({
      to: arbitrumParentMessenger.address,
      value: amoutToSend,
    });

    console.log(`Sent ETH txn: ${sendEthTxn.hash}`);
  } else {
    console.log("Arbitrum messenger has enough ETH");
  }
};

export const decodeData = (
  data: string
): {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
} => {
  return TransactionDataDecoder.getInstance().decodeTransaction(data);
};

export const decodeRelayMessages = (
  callData: string
): { governorRootRelays: RelayTransaction[]; governorHubRelays: RelayTransaction[] } => {
  const decodedData = decodeData(callData);
  const decodedSubTransactions = decodedData.params.transactions.map((transaction: ProposedTransaction) => ({
    to: transaction.to,
    transaction: decodeData(transaction.data),
  }));

  const governorRootRelays: RelayTransaction[] = [];
  const governorHubRelays: RelayTransaction[] = [];

  decodedSubTransactions.forEach((relayTransaction: RelayTransaction) => {
    if (relayTransaction.transaction.name === "relayGovernance") {
      if (relayTransaction.transaction.params.calls) {
        governorHubRelays.push(relayTransaction);
      } else {
        governorRootRelays.push(relayTransaction);
      }
    }
  });

  return { governorRootRelays, governorHubRelays };
};
