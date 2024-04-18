// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Export following environment variables:
// - GCKMS_WALLET: (optional) GCKMS wallet name
// - UMIP_NUMBER: Number in UMIP repository
// - PARENT_MESSENGER_NAME: Contract name for the parent messenger on mainnet (e.g. Blast_ParentMessenger)
// Then run the script with:
// yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger/0_Propose.ts --network <network>

const hre = require("hardhat");

import {
  getParentMessengerBaseAbi,
  GovernorHubEthers,
  OracleHubEthers,
  ParentMessengerBaseEthers,
  ProposerV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner } from "@uma/common";
import { BigNumberish, Contract, Signer, Wallet } from "ethers";
import { BytesLike } from "ethers/lib/utils";
import { getAddress } from "../../upgrade-tests/register-new-contract/common";
import { getContractInstance } from "../../utils/contracts";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  const umipNumber = Number(process.env.UMIP_NUMBER);
  if (!Number.isInteger(umipNumber)) throw new Error("Missing or invalid UMIP_NUMBER env");

  const parentMessengerName = process.env.PARENT_MESSENGER_NAME;
  if (parentMessengerName === undefined) throw new Error("Missing PARENT_MESSENGER_NAME env");

  let proposerSigner: Signer;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await await getContractInstance<ProposerV2Ethers>("ProposerV2");

  const parentMessengerAddress = await getAddress(parentMessengerName, 1);
  const oracleHub = await getContractInstance<OracleHubEthers>("OracleHub");
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub");

  const parentMessenger = new Contract(
    parentMessengerAddress,
    getParentMessengerBaseAbi(),
    hre.ethers.provider
  ) as ParentMessengerBaseEthers;
  const targetChainId = await parentMessenger.childChainId();

  // set messenger in oracle hub
  const setMessengerOracleHubTx = await oracleHub.populateTransaction.setMessenger(
    targetChainId,
    parentMessengerAddress
  );
  if (!setMessengerOracleHubTx.data) throw "setMessengerOracleHubTx.data is null";
  adminProposalTransactions.push({ to: oracleHub.address, value: 0, data: setMessengerOracleHubTx.data });

  // set messenger in governor hub
  const setMessengerGovernorHubTx = await governorHub.populateTransaction.setMessenger(
    targetChainId,
    parentMessengerAddress
  );
  if (!setMessengerGovernorHubTx.data) throw "setMessengerGovernorHubTx.data is null";
  adminProposalTransactions.push({ to: governorHub.address, value: 0, data: setMessengerGovernorHubTx.data });

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const proposalExplanation = `UMIP-${umipNumber} Register parent messenger ${parentMessengerAddress} on chain ${targetChainId}`;

  console.log(`Submitting proposal for: ${proposalExplanation}`);

  const tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
    .connect(proposerSigner)
    .propose(adminProposalTransactions, hre.ethers.utils.toUtf8Bytes(proposalExplanation));

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
