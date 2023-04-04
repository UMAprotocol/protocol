import { strict as assert } from "assert";
import { Signer, Wallet } from "ethers";
import hre from "hardhat";
import { Provider } from "@ethersproject/abstract-provider";
import { getGckmsSigner, TokenRolesEnum } from "@uma/common";
import { ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";
import { AdminProposalTransaction } from "../upgrade-tests/voting2/migrationUtils";
const { ethers } = hre;

require("dotenv").config();

const proposerAddress = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function proposeRevokeMinters(): Promise<void> {
  assert((await ethers.provider.getNetwork()).chainId === 1, "Can propose only on mainnet");
  assert(process.env.TRACE !== "1" || hre.network.name === "localhost", "Tracing available only for forked network");
  assert(process.env.REVOKED_MINTERS !== undefined, "REVOKED_MINTERS must be set");
  const revokedMinters = JSON.parse(process.env.REVOKED_MINTERS);
  assert(revokedMinters.length > 0, "REVOKED_MINTERS cannot be empty");
  for (const revokedMinter of revokedMinters) {
    assert(ethers.utils.isAddress(revokedMinter), "REVOKED_MINTERS must be an array of addresses");
  }
  assert(process.env.UMIP !== undefined, "UMIP must be set");
  assert(Number(process.env.UMIP) > 0, "Invalid UMIP number");

  let proposerSigner: Signer;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(ethers.provider as Provider);
    if (proposerAddress.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    if (hre.network.name !== "localhost") throw new Error("Cannot impersonate on mainnet");
    proposerSigner = (await ethers.getImpersonatedSigner(proposerAddress)) as Signer;
  }

  // Approve required bond amount if necessary.
  const proposerV2 = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const bond = await proposerV2.bond();
  const allowance = await votingToken.allowance(proposerAddress, proposerV2.address);
  if (allowance.lt(bond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposerV2.address, bond);
    await approveTx.wait();
  }

  // Check proposer balance.
  const balance = await votingToken.balanceOf(proposerAddress);
  if (balance.lt(bond)) throw new Error("Insufficient proposer balance");

  // Propose revoking minter role.
  const adminProposalTransactions: AdminProposalTransaction[] = [];
  for (const revokedMinter of revokedMinters) {
    adminProposalTransactions.push({
      to: votingToken.address,
      value: "0",
      data: votingToken.interface.encodeFunctionData("removeMember", [TokenRolesEnum.MINTER, revokedMinter]),
    });
  }
  console.log("Sending proposal transactions to the proposer");
  const ancillaryData =
    "title: Admin proposal revoking minter role from depreciated contracts, umip: " +
    `"https://github.com/UMAprotocol/UMIPs/blob/master/UMIPs/umip-${process.env.UMIP}.md"`;
  const txn = await proposerV2
    .connect(proposerSigner)
    .propose(adminProposalTransactions, ethers.utils.toUtf8Bytes(ancillaryData));
  await txn.wait();
  if (process.env.TRACE === "1") await hre.run("trace", { hash: txn.hash });
}

function main() {
  const startTime = Date.now();
  proposeRevokeMinters()
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
