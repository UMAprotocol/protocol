// This script create a proposal to change the GAT and SPAT in the VotingV2 contract.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// NODE_URL_1=<MAINNET-NODE-URL> \
// UMIP=<UMIP> \ # e.g. 186
// GAT=<GAT> \ # e.g. 5000000
// SPAT=<SPAT> \ # e.g. 65
// yarn hardhat run packages/scripts/src/admin-proposals/set-gat-and-spat/0_Propose.ts --network localhost

require("dotenv").config();
import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner } from "@uma/common";
import { ProposerV2Ethers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { strict as assert } from "assert";
import { Signer, Wallet } from "ethers";
import hre from "hardhat";
import { AdminProposalTransaction } from "../../upgrade-tests/voting2/migrationUtils";
import { getContractInstance } from "../../utils/contracts";
import { PROPOSER_ADDRESS } from "../common";
const { ethers } = hre;

function parseEnvVars() {
  const { GAT, SPAT, UMIP, GCKMS_WALLET, TRACE } = process.env;
  assert(GAT && !isNaN(Number(GAT)), "Invalid or missing GAT"); // GAT in token units scaled by UMA VotingToken decimals
  assert(SPAT && !isNaN(Number(SPAT)), "Invalid or missing SPAT"); // SPAT as 65% → 0.65 * 1e18 (scaled with 16 decimals)
  assert(UMIP && Number(UMIP) > 0, "Invalid or missing UMIP");

  // Validate GAT and SPAT.
  assert(!isNaN(Number(process.env.GAT)) && Number(process.env.GAT) > 0, "GAT must be a number greater than 0");
  assert(!isNaN(Number(process.env.SPAT)) && Number(process.env.SPAT) > 0, "SPAT must be a number greater than 0");
  assert(Number(process.env.SPAT) < 100, "SPAT must be less than 100%");
  return {
    gat: ethers.utils.parseEther(GAT),
    spat: ethers.utils.parseUnits(SPAT, 16),
    umip: UMIP,
    gckmsWallet: GCKMS_WALLET,
    trace: TRACE,
  };
}

async function setGatAndSpat(): Promise<void> {
  assert((await ethers.provider.getNetwork()).chainId === 1, "Can propose emission rate only on mainnet");

  const { gat, spat, umip, gckmsWallet, trace } = parseEnvVars();

  console.log("Proposing GAT and SPAT", { gat, spat });

  let proposerSigner: Signer;

  if (gckmsWallet) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(ethers.provider as Provider);
    if (PROPOSER_ADDRESS.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    if (hre.network.name !== "localhost") throw new Error("Cannot impersonate on mainnet");
    proposerSigner = (await ethers.getImpersonatedSigner(PROPOSER_ADDRESS)) as Signer;
  }

  // Approve required bond amount if necessary.
  const proposerV2 = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const bond = await proposerV2.bond();
  const allowance = await votingToken.allowance(PROPOSER_ADDRESS, proposerV2.address);
  if (allowance.lt(bond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposerV2.address, bond);
    await approveTx.wait();
  }

  // Check proposer balance.
  const balance = await votingToken.balanceOf(PROPOSER_ADDRESS);
  if (balance.lt(bond)) throw new Error("Insufficient proposer balance");

  // Propose new gat and spat.
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");
  const adminProposalTransactions: AdminProposalTransaction[] = [];
  adminProposalTransactions.push({
    to: votingV2.address,
    value: ethers.constants.Zero,
    data: votingV2.interface.encodeFunctionData("setGatAndSpat", [gat, spat]),
  });
  console.log("Sending proposal transactions to the proposer");
  const ancillaryData =
    "title: Admin proposal setting GAT to " +
    ethers.utils.formatEther(gat) +
    " tokens and SPAT to " +
    ethers.utils.formatUnits(spat, 16) +
    "%" +
    ", umip: " +
    `"https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-${umip}.md"`;

  console.log("Proposing transaction with ancillary data: ", ancillaryData);
  const txn = await proposerV2
    .connect(proposerSigner)
    .propose(adminProposalTransactions, ethers.utils.toUtf8Bytes(ancillaryData));
  await txn.wait();
  if (trace) await hre.run("trace", { hash: txn.hash });
}

function main() {
  const startTime = Date.now();
  setGatAndSpat()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}

if (require.main === module) {
  main();
}
