import { BigNumber, Contract, ContractTransaction, utils as ethersUtils } from "ethers";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import { ArbitrumParentMessenger } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import hre from "hardhat";
import { getImpersonatedSigner, getJsonRpcProvider, getOVMParentMessenger } from "./helpers";
import { OVMNetwork } from "./networks";
import {
  InboxMessageDeliveredData,
  InboxMessageDeliveredEvent,
  MessageDeliveredEvent,
  SentMessageEvent,
  StateSyncedEvent,
} from "./types";
import { getContractInstance } from "../../utils/contracts";
import { GovernorRootTunnelEthers } from "@uma/contracts-node";

function applyL1ToL2Alias(l1Address: string): string {
  const OFFSET = BigNumber.from("0x1111000000000000000000000000000000001111");
  const l1BN = BigNumber.from(l1Address);
  const aliasBN = l1BN.add(OFFSET).mod(BigNumber.from(2).pow(160));
  return ethersUtils.getAddress(aliasBN.toHexString());
}

export async function spoofOVMRelay(l2NetworkName: OVMNetwork, l1TxReceipt: TransactionReceipt): Promise<void> {
  const l2Provider = getJsonRpcProvider(l2NetworkName);

  // When relaying, the message sender is the aliased L1CrossDomainMessenger.
  const ovmParentMessenger = await getOVMParentMessenger(l2NetworkName);
  const ovmL1CrossDomainMessengerAddress = await ovmParentMessenger.messenger();
  const aliasedL1CrossDomainMessengerAddress = applyL1ToL2Alias(ovmL1CrossDomainMessengerAddress);
  const aliasedL1CrossDomainMessengerSigner = await getImpersonatedSigner(
    l2Provider,
    aliasedL1CrossDomainMessengerAddress,
    10
  );

  // Only need the SentMessage event on the L1CrossDomainMessenger to get the message to relay.
  const l1CrossDomainMessengerIface = new ethersUtils.Interface([
    "event SentMessage (address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)",
  ]);
  const sentMessageTopic = l1CrossDomainMessengerIface.getEventTopic("SentMessage");

  // Will use the relayMessage call on the L2CrossDomainMessenger to relay the message.
  const l2CrossDomainMessengerIface = new ethersUtils.Interface([
    "function relayMessage(uint256 _nonce, address _sender, address _target, uint256 _value, uint256 _minGasLimit, bytes calldata _message) external payable",
  ]);
  const l2CrossDomainMessengerAddress = "0x4200000000000000000000000000000000000007";
  const l2CrossDomainMessenger = new Contract(
    l2CrossDomainMessengerAddress,
    l2CrossDomainMessengerIface,
    aliasedL1CrossDomainMessengerSigner
  );

  // Spoof the relay on L2 for each matching SentMessage event in the txReceipt.
  for (const log of l1TxReceipt.logs) {
    if (log.address === ovmL1CrossDomainMessengerAddress && log.topics[0] === sentMessageTopic) {
      // Get the matched event and its arguments.
      const parsedLog = l1CrossDomainMessengerIface.parseLog(log);
      const eventArgs = parsedLog.args as SentMessageEvent["args"];

      process.stdout.write(
        `Submitting ${l2NetworkName} relay for messageNonce ${eventArgs.messageNonce.toString()}...`
      );
      const relayTx = (await l2CrossDomainMessenger.relayMessage(
        eventArgs.messageNonce,
        eventArgs.sender,
        eventArgs.target,
        0,
        eventArgs.gasLimit,
        eventArgs.message,
        { gasLimit: eventArgs.gasLimit.mul(2) } // Double gas should be sufficient to execute the outer call.
      )) as ContractTransaction;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `Submitting ${l2NetworkName} relay for messageNonce ${eventArgs.messageNonce.toString()}, txn: ${
          relayTx.hash
        }...`
      );
      try {
        await relayTx.wait();
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(
          `Submitted ${l2NetworkName} relay for messageNonce ${eventArgs.messageNonce.toString()}, txn: ${
            relayTx.hash
          }\n`
        );
      } catch (e) {
        console.error(
          `\nError submitting ${l2NetworkName} relay for messageNonce ${eventArgs.messageNonce.toString()}, txn: ${
            relayTx.hash
          }, check if it has not been relayed already.`
        );
      }
    }
  }
}

export async function spoofArbitrumRelay(l1TxReceipt: TransactionReceipt): Promise<void> {
  const l2NetworkName = "arbitrum";
  const l2Provider = getJsonRpcProvider(l2NetworkName);

  // Get Arbitrum inbox and bridge contracts and their events on L1.
  const avmParentMessenger = await getContractInstance<ArbitrumParentMessenger>("Arbitrum_ParentMessenger");
  const inboxAddress = await avmParentMessenger.inbox();
  const inboxIface = new ethersUtils.Interface([
    "function bridge() public view returns (address)",
    "event InboxMessageDelivered(uint256 indexed messageNum, bytes data)",
  ]);
  const inboxMessageDeliveredTopic = inboxIface.getEventTopic("InboxMessageDelivered");
  const inbox = new Contract(inboxAddress, inboxIface, hre.ethers.provider);
  const bridgeAddress = (await inbox.bridge()) as string;
  const bridgeIface = new ethersUtils.Interface([
    "event MessageDelivered(uint256 indexed messageIndex, bytes32 indexed beforeInboxAcc, address inbox, uint8 kind, address sender, bytes32 messageDataHash, uint256 baseFeeL1, uint64 timestamp)",
  ]);
  const messageDeliveredTopic = bridgeIface.getEventTopic("MessageDelivered");

  // Spoof the relay on L2 for each matching MessageDelivered and InboxMessageDelivered event in the txReceipt.
  for (const log of l1TxReceipt.logs) {
    if (log.address === bridgeAddress && log.topics[0] === messageDeliveredTopic) {
      // Get the matched events and their arguments.
      const parsedMessageDeliveredLog = bridgeIface.parseLog(log);
      const messageDeliveredEventArgs = parsedMessageDeliveredLog.args as MessageDeliveredEvent["args"];
      const inboxMessageDeliveredLog = l1TxReceipt.logs.find((log) => {
        if (log.address !== inboxAddress || log.topics[0] !== inboxMessageDeliveredTopic) return false;
        const parsedLog = inboxIface.parseLog(log);
        const eventArgs = parsedLog.args as InboxMessageDeliveredEvent["args"];
        return messageDeliveredEventArgs.messageIndex.eq(eventArgs.messageNum);
      });
      if (!inboxMessageDeliveredLog) continue;
      const parsedInboxMessageDeliveredLog = inboxIface.parseLog(inboxMessageDeliveredLog);
      const inboxMessageDeliveredEventArgs = parsedInboxMessageDeliveredLog.args as InboxMessageDeliveredEvent["args"];

      // Decode the data from the InboxMessageDelivered event. This is abi.encodePacked where each field is padded to 32
      // bytes, except for the last one which is the message data and its length is added before it. We transform this
      // as it was ABI encoded (abi.encode), so its easier to decode.
      const abiEncodePackedData = inboxMessageDeliveredEventArgs.data;
      const callDataFieldIndex = 8; // The call data field is the 9th field in the encoded event data.
      const callDataBytesOffset = ethersUtils.defaultAbiCoder.encode(["uint256"], [(callDataFieldIndex + 1) * 32]);
      const abiEncodedCallData = ethersUtils.defaultAbiCoder.encode(
        ["bytes"],
        ["0x" + abiEncodePackedData.slice(2 + (callDataFieldIndex + 1) * 64)]
      );
      const abiEncodedData =
        abiEncodePackedData.slice(0, 2 + callDataFieldIndex * 64) + // Regular bytes32 fields.
        callDataBytesOffset.slice(2) + // Recalculated call data offset.
        abiEncodedCallData.slice(2 + 64); // Encoded call data without the offset prefix.

      // Decode the data from the InboxMessageDelivered event.
      const dataTypes = [
        "address to",
        "uint256 l2CallValue",
        "uint256 amount",
        "uint256 maxSubmissionCost",
        "address excessFeeRefundAddress",
        "address callValueRefundAddress",
        "uint256 gasLimit",
        "uint256 maxFeePerGas",
        "bytes data",
      ];
      const decodedData = ethersUtils.defaultAbiCoder.decode(dataTypes, abiEncodedData) as InboxMessageDeliveredData;

      // Get the spoofed signer and send the relayed transaction.
      const senderSigner = await getImpersonatedSigner(l2Provider, messageDeliveredEventArgs.sender, 10);
      process.stdout.write(
        `Submitting ${l2NetworkName} relay for messageNum ${inboxMessageDeliveredEventArgs.messageNum.toString()}...`
      );
      const relayTx = await senderSigner.sendTransaction({
        to: decodedData.to,
        value: decodedData.l2CallValue,
        data: decodedData.data,
        gasLimit: decodedData.gasLimit,
      });
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `Submitting ${l2NetworkName} relay for messageNum ${inboxMessageDeliveredEventArgs.messageNum.toString()}, txn: ${
          relayTx.hash
        }...`
      );
      await relayTx.wait();
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `Submitted ${l2NetworkName} relay for messageNum ${inboxMessageDeliveredEventArgs.messageNum.toString()}, txn: ${
          relayTx.hash
        }\n`
      );
    }
  }
}

export async function spoofPolygonRelay(l1TxReceipt: TransactionReceipt): Promise<void> {
  const l2NetworkName = "polygon";
  const l2Provider = getJsonRpcProvider(l2NetworkName);

  // When relaying, the expected message sender is hardcoded in the FxChild contract.
  const fxChildSenderAddress = "0x0000000000000000000000000000000000001001";
  const fxChildSenderSigner = await getImpersonatedSigner(l2Provider, fxChildSenderAddress, 10);

  // Get Polygon state sender contract and StateSynced event topic to filter on L1.
  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel");
  const fxRootAddress = await governorRootTunnel.fxRoot();
  const fxRootIface = new ethersUtils.Interface([
    "function stateSender() public view returns (address)",
    "function fxChild() public view returns (address)",
  ]);
  const fxRoot = new Contract(fxRootAddress, fxRootIface, hre.ethers.provider);
  const stateSenderAddress = (await fxRoot.stateSender()) as string;
  const stateSenderIface = new ethersUtils.Interface([
    "event StateSynced(uint256 indexed id, address indexed contractAddress, bytes data)",
  ]);
  const stateSyncedTopic = stateSenderIface.getEventTopic("StateSynced");

  // Will relay the transaction on the FxChild contract on Polygon.
  const fxChildAddress = (await fxRoot.fxChild()) as string;
  const fxChildIface = new ethersUtils.Interface(["function onStateReceive(uint256 stateId, bytes calldata _data)"]);
  const fxChild = new Contract(fxChildAddress, fxChildIface, fxChildSenderSigner);

  // Spoof the relay on L2 for each matching StateSynced event in the txReceipt.
  for (const log of l1TxReceipt.logs) {
    if (log.address === stateSenderAddress && log.topics[0] === stateSyncedTopic) {
      // Get the matched event and its arguments.
      const parsedLog = stateSenderIface.parseLog(log);
      const eventArgs = parsedLog.args as StateSyncedEvent["args"];
      if (eventArgs.contractAddress !== fxChildAddress) continue;

      process.stdout.write(`Submitting ${l2NetworkName} relay for stateId ${eventArgs.id.toString()}...`);
      const relayTx = (await fxChild.onStateReceive(eventArgs.id, eventArgs.data)) as ContractTransaction;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `Submitting ${l2NetworkName} relay for stateId ${eventArgs.id.toString()}, txn: ${relayTx.hash}...`
      );
      await relayTx.wait();
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(
        `Submitted ${l2NetworkName} relay for stateId ${eventArgs.id.toString()}, txn: ${relayTx.hash}\n`
      );
    }
  }
}
