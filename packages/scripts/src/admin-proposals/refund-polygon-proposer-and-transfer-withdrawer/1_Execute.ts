import { strict as assert } from "assert";
import { Contract, providers } from "ethers";
import hre from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { getImpersonatedSigner, getJsonRpcProvider, getProposerSigner } from "../common";
import {
  ADDRESSES,
  AMOUNT,
  assertProposal,
  assertStartingState,
  connect,
  proposalId,
  verifyPolygonReceipts,
} from "./common";
import { getStateSyncMessages, STATE_RECEIVER } from "./stateSync";

// Relay the exact StateSynced messages on the Polygon fork and retain receipts for payment verification.
async function relayOnFork(polygon: providers.JsonRpcProvider, root: Contract, receipt: providers.TransactionReceipt) {
  const { fxChild: fxChildAddress, messages } = await getStateSyncMessages(root, receipt);
  const sender = await getImpersonatedSigner(polygon, STATE_RECEIVER, 10);
  const fxChild = new Contract(fxChildAddress, ["function onStateReceive(uint256 stateId, bytes data)"], sender);
  const receipts: providers.TransactionReceipt[] = [];
  for (const message of messages) {
    assert.equal(message.contractAddress.toLowerCase(), fxChildAddress.toLowerCase(), "Unexpected state-sync receiver");
    const tx = await fxChild.onStateReceive(message.id, message.data);
    receipts.push(await tx.wait());
  }
  return receipts;
}

async function main() {
  const id = proposalId();
  const polygon = getJsonRpcProvider("polygon");
  const contracts = await connect(hre.ethers.provider, polygon);
  const proposal = await contracts.governor.getProposal(id);
  // Deliberately reject already/partially executed proposals; recovery needs inspection of the delivered messages.
  assertProposal(proposal.transactions, proposal.ancillaryData);
  await assertStartingState(contracts);
  const fork = hre.network.name === "localhost";
  assert(process.env.GCKMS_WALLET || fork, "Production execution requires GCKMS_WALLET");
  if (fork) {
    // Ensure both endpoints support Hardhat before submitting anything to either fork.
    await hre.ethers.provider.send("hardhat_metadata", []);
    await polygon.send("hardhat_metadata", []);
  }
  const balances = await Promise.all(
    [ADDRESSES.store, ADDRESSES.child, ADDRESSES.recipient].map((address) => contracts.token.balanceOf(address))
  );
  const signer = await getProposerSigner(ADDRESSES.proposerWallet);
  const calls = proposal.transactions.map((_, i) =>
    contracts.governor.interface.encodeFunctionData("executeProposal", [id, i])
  );
  console.log("POLYGON_FROM_BLOCK=" + (await polygon.getBlockNumber()));
  const tx = await contracts.governor.connect(signer).multicall(calls);
  console.log("L1 execution transaction:", tx.hash);
  console.log("L1_EXECUTE_TX=" + tx.hash);
  const receipt = await tx.wait();
  if (!fork) {
    console.log(
      "Wait for all four Polygon relays, then run 2_Verify.ts with L1_EXECUTE_TX and POLYGON_FROM_BLOCK printed above."
    );
    return;
  }
  const receipts = await relayOnFork(polygon, contracts.root, receipt);
  console.log("POLYGON_EXECUTE_TXS=" + receipts.map((r) => r.transactionHash).join(","));
  await verifyPolygonReceipts(contracts, receipts);
  const after = await Promise.all(
    [ADDRESSES.store, ADDRESSES.child, ADDRESSES.recipient].map((address) => contracts.token.balanceOf(address))
  );
  assert(after[0].eq(balances[0].sub(AMOUNT)), "Unexpected Store balance delta");
  assert(after[1].eq(balances[1]), "Refund left funds in the child tunnel");
  assert(after[2].eq(balances[2].add(AMOUNT)), "Unexpected recipient balance delta");
  for (const formerWithdrawer of [ADDRESSES.proposerWallet, ADDRESSES.child]) {
    await assert.rejects(
      contracts.store.callStatic.withdrawErc20(ADDRESSES.token, 0, { from: formerWithdrawer }),
      /Sender does not hold required role/
    );
  }
  await contracts.store.callStatic.withdrawErc20(ADDRESSES.token, 0, { from: ADDRESSES.multisig });
  console.log("Fork payment and withdrawer handover verified.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
