import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { ArbitrumParentMessenger, GovernorHub, GovernorRootTunnel } from "@uma/contracts-node/typechain/core/ethers";
import { PopulatedTransaction, Signer } from "ethers";
const hre = require("hardhat");

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
  governorRootTunnel: GovernorRootTunnel
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
  governorHub: GovernorHub,
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
  l1Governor: GovernorHub | GovernorRootTunnel,
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
  console.log("isPolygon", isPolygon);
  if (isPolygon) {
    const relayedMessages = [];
    for (const message of messages) {
      relayedMessages.push(
        await relayGovernanceRootTunnelMessage(message.targetAddress, message.tx, l1Governor as GovernorRootTunnel)
      );
    }
    return relayedMessages;
  }
  return relayGovernanceHubMessages(messages, l1Governor as GovernorHub, chainId);
};

export const fundArbitrumParentMessengerForRelays = async (
  arbitrumParentMessenger: ArbitrumParentMessenger,
  from: Signer,
  totalNumberOfTransactions: BigNumberish
): Promise<void> => {
  // Sending a xchain transaction to Arbitrum will fail unless Arbitrum messenger has enough ETH to pay for message:
  const l1CallValue = await arbitrumParentMessenger.getL1CallValue();
  console.log(
    `Arbitrum xchain messages require that the Arbitrum_ParentMessenger has at least a ${hre.ethers.utils.formatEther(
      l1CallValue.mul(totalNumberOfTransactions)
    )} ETH balance.`
  );

  const apmBalance = await arbitrumParentMessenger.provider.getBalance(arbitrumParentMessenger.address);

  if (apmBalance.lt(l1CallValue.mul(totalNumberOfTransactions))) {
    const amoutToSend = l1CallValue.mul(totalNumberOfTransactions).sub(apmBalance);
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
