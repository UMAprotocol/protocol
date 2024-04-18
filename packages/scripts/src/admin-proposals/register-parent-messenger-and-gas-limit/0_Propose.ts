// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger-and-gas-limit/0_Propose.ts --network <network>

const hre = require("hardhat");

import { GovernorHubEthers, OracleHubEthers, ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";

import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner } from "@uma/common";
import { OptimismParentMessenger } from "@uma/contracts-node/typechain/core/ethers";
import { BigNumberish, Signer, Wallet } from "ethers";
import { BytesLike } from "ethers/lib/utils";
import { getAddress } from "../../upgrade-tests/register-new-contract/common";
import { getContractInstance } from "../../utils/contracts";
import { BASE_CHAIN_ID, PARENT_MESSENGER_DEFAULT_GAS_LIMIT } from "./common";

interface AdminProposalTransaction {
  to: string;
  value: BigNumberish;
  data: BytesLike;
}

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

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

  const baseParentMessengerAddress = await getAddress("Base_ParentMessenger", 1);
  const oracleHub = await getContractInstance<OracleHubEthers>("OracleHub");
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub");
  const optimismParentMessenger = await getContractInstance<OptimismParentMessenger>("Optimism_ParentMessenger");

  // set messenger in oracle hub
  const setMessengerOracleHubTx = await oracleHub.populateTransaction.setMessenger(
    BASE_CHAIN_ID,
    baseParentMessengerAddress
  );
  if (!setMessengerOracleHubTx.data) throw "setMessengerOracleHubTx.data is null";
  adminProposalTransactions.push({ to: oracleHub.address, value: 0, data: setMessengerOracleHubTx.data });

  // set messenger in governor hub
  const setMessengerGovernorHubTx = await governorHub.populateTransaction.setMessenger(
    BASE_CHAIN_ID,
    baseParentMessengerAddress
  );
  if (!setMessengerGovernorHubTx.data) throw "setMessengerGovernorHubTx.data is null";
  adminProposalTransactions.push({ to: governorHub.address, value: 0, data: setMessengerGovernorHubTx.data });

  // set optimism parent messenger defaultGasLimit
  const setParentMessengerDefaultGasLimitTx = await optimismParentMessenger.populateTransaction.setDefaultGasLimit(
    PARENT_MESSENGER_DEFAULT_GAS_LIMIT
  );
  if (!setParentMessengerDefaultGasLimitTx.data) throw "setParentMessengerDefaultGasLimitTx.data is null";
  adminProposalTransactions.push({
    to: optimismParentMessenger.address,
    value: 0,
    data: setParentMessengerDefaultGasLimitTx.data,
  });

  // set base parent messenger defaultGasLimit
  const setBaseParentMessengerDefaultGasLimitTx = await optimismParentMessenger.populateTransaction.setDefaultGasLimit(
    PARENT_MESSENGER_DEFAULT_GAS_LIMIT
  );
  if (!setBaseParentMessengerDefaultGasLimitTx.data) throw "setBaseParentMessengerDefaultGasLimitTx.data is null";
  adminProposalTransactions.push({
    to: baseParentMessengerAddress,
    value: 0,
    data: setBaseParentMessengerDefaultGasLimitTx.data,
  });

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
      hre.ethers.utils.toUtf8Bytes(`Register parent messenger ${baseParentMessengerAddress} on chain ${BASE_CHAIN_ID}`)
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
