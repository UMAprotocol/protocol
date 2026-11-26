import { strict as assert } from "assert";
import { utils } from "ethers";
import hre from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { getJsonRpcProvider, getProposerSigner } from "../common";
import {
  ADDRESSES,
  EXPLANATION,
  assertStartingState,
  connect,
  polygonCalls,
  proposalTransactions,
  storeInterface,
  tokenInterface,
} from "./common";

async function main() {
  const contracts = await connect(hre.ethers.provider, getJsonRpcProvider("polygon"));
  await assertStartingState(contracts);
  const transactions = proposalTransactions();
  const ancillaryData = utils.toUtf8Bytes(EXPLANATION);
  console.log("Proposal explanation:", EXPLANATION);
  console.log("Polygon calls:");
  polygonCalls().forEach((call, index) => {
    const decoded = (call.to === ADDRESSES.token ? tokenInterface : storeInterface).parseTransaction({
      data: call.data,
    });
    console.log({
      index,
      target: call.to,
      function: decoded.signature,
      args: decoded.args.map((arg) => arg.toString()),
    });
  });
  console.log("Mainnet transactions:", transactions);
  console.log(
    "Proposal calldata:",
    contracts.proposer.interface.encodeFunctionData("propose", [transactions, ancillaryData])
  );
  if (process.env.DRY_RUN === "1") return;

  assert(process.env.GCKMS_WALLET || hre.network.name === "localhost", "Production submission requires GCKMS_WALLET");
  const signer = await getProposerSigner(ADDRESSES.proposerWallet);
  const bond = await contracts.proposer.bond();
  assert(
    (await contracts.votingToken.balanceOf(ADDRESSES.proposerWallet)).gte(bond),
    "Insufficient proposer UMA balance"
  );
  if ((await contracts.votingToken.allowance(ADDRESSES.proposerWallet, ADDRESSES.proposer)).lt(bond)) {
    const approval = await contracts.votingToken.connect(signer).approve(ADDRESSES.proposer, bond);
    console.log("Bond approval:", approval.hash);
    await approval.wait();
  }
  const tx = await contracts.proposer.connect(signer).propose(transactions, ancillaryData);
  console.log("Proposal transaction:", tx.hash);
  const receipt = await tx.wait();
  const log = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === ADDRESSES.governor.toLowerCase() &&
      log.topics[0] === contracts.governor.interface.getEventTopic("NewProposal")
  );
  assert(log, "Missing NewProposal event");
  console.log("PROPOSAL_ID=" + contracts.governor.interface.parseLog(log).args.id.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
