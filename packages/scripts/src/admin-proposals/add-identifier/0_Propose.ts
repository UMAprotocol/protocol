// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// IDENTIFIER=<IDENTIFIER-TO-ADD> \
// UMIP_NUMBER=<UMIP-NUMBER> \
// yarn hardhat run ./src/upgrade-tests/add-identifier/0_Propose.ts --network <network>

const hre = require("hardhat");

import { IdentifierWhitelistEthers, ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner } from "@uma/common";
import { BigNumberish, Signer, Wallet } from "ethers";
import { BytesLike, formatBytes32String } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (!process.env.IDENTIFIER) throw new Error("IDENTIFIER is not set");
  const newIdentifier = formatBytes32String(process.env.IDENTIFIER);

  if (!process.env.UMIP_NUMBER) throw new Error("UMIP_NUMBER is not set");
  const umipNumber = process.env.UMIP_NUMBER;

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
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  // add new identifier to whitelist
  const addIdentifierTx = await identifierWhitelist.populateTransaction.addSupportedIdentifier(newIdentifier);
  if (!addIdentifierTx.data) throw "addIdentifierTx.data is null";
  adminProposalTransactions.push({ to: identifierWhitelist.address, value: 0, data: addIdentifierTx.data });

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
      hre.ethers.utils.toUtf8Bytes(`UMIP-${umipNumber} ${process.env.IDENTIFIER} new identifier`)
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
