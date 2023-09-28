// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// RECIPIENT=<FUNDING-RECEIVER-ADDRESS> \
// TOKEN=<OPTIONAL-TOKEN-ADDRESS> \
// AMOUNT=<FUNDING-AMOUNT> \
// PROPOSAL_URL=<PROPOSAL-URL> \
// yarn hardhat run ./src/admin-proposals/funding/0_Propose.ts --network <network>

import { strict as assert } from "assert";
import { BigNumber, Signer } from "ethers";
import hre from "hardhat";
import { getGckmsSigner } from "@uma/common";
import { getAddress, ERC20Ethers, ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { AdminProposalTransaction } from "../../upgrade-tests/voting2/migrationUtils";

const { ethers } = hre;

require("dotenv").config();

const proposerAddress = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

interface ProposalParams {
  proposerSigner: Signer;
  recipient: string;
  tokenAddress: string;
  amount: number;
  proposalUrl: string;
  trace: boolean;
}

async function getProposerSigner(env: NodeJS.ProcessEnv): Promise<Signer> {
  let proposerSigner: Signer;

  if (env.GCKMS_WALLET) {
    proposerSigner = (await getGckmsSigner()).connect(ethers.provider);
    if (proposerAddress.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    if (hre.network.name !== "localhost") throw new Error("Cannot impersonate on mainnet");
    proposerSigner = await ethers.getImpersonatedSigner(proposerAddress);
  }

  return proposerSigner;
}

async function initProposalParams(env: NodeJS.ProcessEnv): Promise<ProposalParams> {
  assert((await ethers.provider.getNetwork()).chainId === 1, "Can propose only on mainnet");
  assert(env.TRACE !== "1" || hre.network.name === "localhost", "Tracing available only for forked network");
  assert(env.RECIPIENT !== undefined, "RECIPIENT must be set");
  assert(ethers.utils.isAddress(env.RECIPIENT), "RECIPIENT must be an addresses");
  assert(env.TOKEN === undefined || ethers.utils.isAddress(env.TOKEN), "TOKEN must be an address");
  assert(env.AMOUNT !== undefined, "AMOUNT must be set");
  assert(!isNaN(Number(env.AMOUNT)) && Number(env.AMOUNT) > 0, "AMOUNT must be positive number");
  assert(env.PROPOSAL_URL !== undefined, "PROPOSAL_URL must be set");
  try {
    new URL(env.PROPOSAL_URL);
  } catch {
    throw new Error("PROPOSAL_URL must be a valid URL");
  }

  return {
    proposerSigner: await getProposerSigner(env),
    recipient: env.RECIPIENT,
    tokenAddress: env.TOKEN || (await getAddress("VotingToken", 1)), // Default to UMA if token not provided.
    amount: Number(env.AMOUNT),
    proposalUrl: env.PROPOSAL_URL,
    trace: env.TRACE === "1",
  };
}

async function getAndVerifyFundingAmount(
  params: ProposalParams
): Promise<{ token: ERC20Ethers; fundingAmount: BigNumber }> {
  // Get amount scaled by decimals.
  const token = await getContractInstance<ERC20Ethers>("ERC20", params.tokenAddress);
  const decimals = await token.decimals();
  const fundingAmount = BigNumber.from(params.amount).mul(BigNumber.from(10).pow(decimals));

  // Verify that GovernorV2 has sufficient balance.
  const governorV2Address = await getAddress("GovernorV2", 1);
  const governorBalance = await token.balanceOf(governorV2Address);
  if (governorBalance.lt(fundingAmount)) throw new Error("Insufficient balance to fund proposal");

  return { token, fundingAmount };
}

async function verifyProposerBond(params: ProposalParams, proposerV2: ProposerV2Ethers): Promise<void> {
  // Approve required bond amount if necessary.
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const bond = await proposerV2.bond();
  const allowance = await votingToken.allowance(proposerAddress, proposerV2.address);
  if (allowance.lt(bond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(params.proposerSigner).approve(proposerV2.address, bond);
    await approveTx.wait();
  }

  // Check proposer balance.
  const balance = await votingToken.balanceOf(proposerAddress);
  if (balance.lt(bond)) throw new Error("Insufficient proposer balance");
}

async function main() {
  const params = await initProposalParams(process.env);

  // Get raw funding amount and verify the governor has sufficient balance.
  const { token, fundingAmount } = await getAndVerifyFundingAmount(params);

  // Make sure proposer has sufficient bond balance and allowance.
  const proposerV2 = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  await verifyProposerBond(params, proposerV2);

  // Construct and propose funding transaction.
  const adminProposalTransactions: AdminProposalTransaction[] = [
    {
      to: params.tokenAddress,
      value: "0",
      data: token.interface.encodeFunctionData("transfer", [params.recipient, fundingAmount]),
    },
  ];
  console.log("Sending proposal transactions to the proposer");
  const ancillaryData = `title: Admin funding proposal, proposalUrl: "${params.proposalUrl}"`;
  const txn = await proposerV2
    .connect(params.proposerSigner)
    .propose(adminProposalTransactions, ethers.utils.toUtf8Bytes(ancillaryData));
  await txn.wait();
  if (params.trace) await hre.run("trace", { hash: txn.hash });
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
