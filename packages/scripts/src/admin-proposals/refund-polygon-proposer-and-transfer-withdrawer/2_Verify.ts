import { strict as assert } from "assert";
import hre from "hardhat";
import "@nomiclabs/hardhat-ethers";
import { getJsonRpcProvider } from "../common";
import { connect, verifyPolygonReceipts } from "./common";
import { findPolygonReceipts, getStateSyncMessages } from "./stateSync";

async function main() {
  const polygon = getJsonRpcProvider("polygon");
  const contracts = await connect(hre.ethers.provider, polygon);
  let receipts;
  if (hre.network.name === "localhost") {
    // Fork delivery calls FxChild directly, so it emits no StateCommitted events.
    const hashes = process.env.POLYGON_EXECUTE_TXS?.split(",");
    assert(
      hashes?.length && hashes.every((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash)),
      "Set POLYGON_EXECUTE_TXS to the distinct comma-separated fork relay transaction hashes"
    );
    receipts = await Promise.all(
      hashes.map(async (hash) => {
        const receipt = await polygon.getTransactionReceipt(hash);
        assert(receipt, `Polygon receipt not found: ${hash}`);
        return receipt;
      })
    );
  } else {
    const hash = process.env.L1_EXECUTE_TX;
    assert(hash && /^0x[0-9a-fA-F]{64}$/.test(hash), "Set L1_EXECUTE_TX to the L1 execution transaction hash");
    const start = process.env.POLYGON_FROM_BLOCK;
    assert(start && /^\d+$/.test(start), "Set POLYGON_FROM_BLOCK to the Polygon block recorded before L1 execution");
    const receipt = await hre.ethers.provider.getTransactionReceipt(hash);
    assert(receipt, `L1 receipt not found: ${hash}`);
    const { messages } = await getStateSyncMessages(contracts.root, receipt);
    receipts = await findPolygonReceipts(
      polygon,
      messages.map((message) => message.id),
      Number(start),
      await polygon.getBlockNumber()
    );
    console.log("POLYGON_EXECUTE_TXS=" + receipts.map((r) => r.transactionHash).join(","));
  }
  await verifyPolygonReceipts(contracts, receipts);
  console.log("Verified the 37,875 USDC.e payment and multisig-only Store withdrawal authority.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
