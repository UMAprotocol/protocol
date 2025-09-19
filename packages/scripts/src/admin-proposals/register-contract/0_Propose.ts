// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// CONTRACT_ADDRESS=<CONTRACT-TO-ADD> \
// CONTRACT_NETWORK=<CONTRACT-NETWORK> \
// UMIP_NUMBER=<UMIP-NUMBER> \
// NODE_URL_1=<MAINNET-NODE-URL> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_8453=<BASE-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// NODE_URL_81457=<BLAST-NODE-URL> \
// yarn hardhat run packages/scripts/src/admin-proposals/register-contract/0_Propose.ts --network <network>

const hre = require("hardhat");

import {
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  ParentMessengerBaseEthers,
  ProposerV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner, RegistryRolesEnum } from "@uma/common";
import { BigNumberish, PopulatedTransaction, Signer, Wallet } from "ethers";
import { BytesLike, getAddress } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";
import {
  fundArbitrumParentMessengerForRelays,
  getConnectedRegistry,
  isSupportedNetwork,
  networksNumber,
  relayGovernanceMessages,
} from "./common";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (!process.env.CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set");
  const newContract = getAddress(process.env.CONTRACT_ADDRESS);

  if (!process.env.CONTRACT_NETWORK) throw new Error("CONTRACT_NETWORK is not set");
  const contractNetworkName = process.env.CONTRACT_NETWORK;
  if (!isSupportedNetwork(contractNetworkName)) throw new Error(`Unsupported network: ${contractNetworkName}`);
  const contractChainId = networksNumber[contractNetworkName];
  const isMainnet = contractChainId === 1;
  const isPolygon = contractChainId === 137;
  const isArbitrum = contractChainId === 42161;

  if (!process.env.UMIP_NUMBER) throw new Error("UMIP_NUMBER is not set");
  const umipNumber = process.env.UMIP_NUMBER;

  const arbitrumParentMessenger = await getContractInstance<ParentMessengerBaseEthers>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const registry = await getConnectedRegistry(contractChainId);

  const registryOwner = await registry.getMember(RegistryRolesEnum.OWNER);

  // 1. Temporarily add the owner as a contract creator.
  const addCreatorTx = await registry.populateTransaction.addMember(RegistryRolesEnum.CONTRACT_CREATOR, registryOwner);
  if (!addCreatorTx.data) throw "addCreatorTx.data is null";

  // 2. Register the contract as a verified contract.
  const registerContractTx = await registry.populateTransaction.registerContract([], newContract);
  if (!registerContractTx.data) throw "registerContractTx.data is null";

  // 3. Remove the owner from being a contract creator.
  const removeCreatorTx = await registry.populateTransaction.removeMember(
    RegistryRolesEnum.CONTRACT_CREATOR,
    registryOwner
  );
  if (!removeCreatorTx.data) throw "removeCreatorTx.data is null";

  if (isMainnet) {
    adminProposalTransactions.push({ to: registry.address, value: 0, data: addCreatorTx.data });
    adminProposalTransactions.push({ to: registry.address, value: 0, data: registerContractTx.data });
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeCreatorTx.data });
  } else {
    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];

    governanceMessages.push({ targetAddress: registry.address, tx: addCreatorTx });
    governanceMessages.push({ targetAddress: registry.address, tx: registerContractTx });
    governanceMessages.push({ targetAddress: registry.address, tx: removeCreatorTx });

    if (isArbitrum) await fundArbitrumParentMessengerForRelays(arbitrumParentMessenger, proposerSigner, 1);

    const relayedMessages = await relayGovernanceMessages(
      governanceMessages,
      isPolygon ? governorRootTunnel : governorHub,
      contractChainId
    );
    adminProposalTransactions.push(...relayedMessages);
  }

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
    .connect(proposerSigner)
    .propose(
      adminProposalTransactions,
      hre.ethers.utils.toUtf8Bytes(`UMIP-${umipNumber} register new contract ${newContract} on ${contractNetworkName}`)
    );

  await tx.wait();

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
