// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// ORIGIN_VALIDATOR_ADDRESS=<ORIGIN-VALIDATOR-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/sherlock-update/1_Propose.ts --network <network>

const hre = require("hardhat");

import { IdentifierWhitelistEthers, ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner } from "@uma/common";
import { OriginValidatorEthers as OriginValidator } from "@uma/contracts-node";
import { BigNumberish, Signer, Wallet } from "ethers";
import { BytesLike, formatBytes32String } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const sherlockIdentifier = formatBytes32String("SHERLOCK_CLAIM");

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (!process.env.ORIGIN_VALIDATOR_ADDRESS) throw new Error("ORIGIN_VALIDATOR_ADDRESS is not set");

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  console.log("Running Sherlock identifier update script");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposer = await await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  const originValidator = await getContractInstance<OriginValidator>(
    "OriginValidator",
    process.env["ORIGIN_VALIDATOR_ADDRESS"]
  );

  // validate origin tx
  const validateOriginTx = await originValidator.populateTransaction.validate(
    "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D" // Dev wallet
  );
  if (!validateOriginTx.data) throw "validateOriginTx.data is null";
  adminProposalTransactions.push({ to: originValidator.address, value: 0, data: validateOriginTx.data });

  // remove sherlock identifier from whitelist
  const removeSherlockIdentifierTx = await identifierWhitelist.populateTransaction.removeSupportedIdentifier(
    sherlockIdentifier
  );
  if (!removeSherlockIdentifierTx.data) throw "removeSherlockIdentifierTx.data is null";
  adminProposalTransactions.push({ to: identifierWhitelist.address, value: 0, data: removeSherlockIdentifierTx.data });

  // add sherlock identifier to whitelist
  const addSherlockIdentifierTx = await identifierWhitelist.populateTransaction.addSupportedIdentifier(
    sherlockIdentifier
  );
  if (!addSherlockIdentifierTx.data) throw "addSherlockIdentifierTx.data is null";
  adminProposalTransactions.push({ to: identifierWhitelist.address, value: 0, data: addSherlockIdentifierTx.data });

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
    .connect(proposerSigner)
    .propose(adminProposalTransactions, hre.ethers.utils.toUtf8Bytes("UMIP-176 SHERLOCK_CLAIM identifier update"));

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
