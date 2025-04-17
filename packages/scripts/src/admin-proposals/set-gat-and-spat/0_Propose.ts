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
import { ProposerV2Ethers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { strict as assert } from "assert";
import hre from "hardhat";
import { AdminProposalTransaction } from "../../upgrade-tests/voting2/migrationUtils";
import { getContractInstance } from "../../utils/contracts";
import { approveProposerBond, getProposerSigner, PROPOSER_ADDRESS, submitAdminProposal } from "../common";
const { ethers } = hre;

function parseEnvVars() {
  const { GAT, SPAT, UMIP } = process.env;
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
  };
}

async function setGatAndSpat(): Promise<void> {
  assert((await ethers.provider.getNetwork()).chainId === 1, "Can propose emission rate only on mainnet");

  const { gat, spat, umip } = parseEnvVars();

  console.log("Proposing GAT and SPAT", { gat, spat });

  const proposerSigner = await getProposerSigner(PROPOSER_ADDRESS);

  // Approve required bond amount if necessary.
  await approveProposerBond(proposerSigner);
  const proposerV2 = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const bond = await proposerV2.bond();

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

  const ancillaryData =
    "title: Admin proposal setting GAT to " +
    ethers.utils.formatEther(gat) +
    " tokens and SPAT to " +
    ethers.utils.formatUnits(spat, 16) +
    "%" +
    ", umip: " +
    `"https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-${umip}.md"`;
  await submitAdminProposal(proposerSigner, adminProposalTransactions, ancillaryData);
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
