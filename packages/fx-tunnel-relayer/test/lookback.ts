import { assert } from "chai";
import type Web3 from "web3";
import { earliestBlockForLookback } from "../src/lookback";
import { RelayerConfig } from "../src/RelayerConfig";

describe("timestamp lookback and calldata config", function () {
  const times = [100, 101, 103, 104, 106, 110];
  const web3 = ({
    eth: { getBlock: async (number: number) => ({ number, timestamp: times[number] }) },
  } as unknown) as Web3;
  const latest = { number: 5, timestamp: 110 };
  it("includes the cutoff block on an irregular fast chain", async function () {
    assert.equal(await earliestBlockForLookback(web3, latest, 7), 2);
    assert.equal(await earliestBlockForLookback(web3, latest, 8), 2);
  });
  it("clamps before genesis and accepts zero lookback", async function () {
    assert.equal(await earliestBlockForLookback(web3, latest, 1000), 0);
    assert.equal(await earliestBlockForLookback(web3, latest, 0), 5);
  });
  it("defaults to 120000 bytes and validates overrides", function () {
    assert.equal(new RelayerConfig({}).maxCalldataBytes, 120_000);
    assert.equal(new RelayerConfig({ MAX_CALLDATA_BYTES: "500" }).maxCalldataBytes, 500);
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity"]) {
      assert.throws(() => new RelayerConfig({ MAX_CALLDATA_BYTES: value }), "MAX_CALLDATA_BYTES");
    }
  });
  it("defaults MAX_CHUNKED_PROOF_BYTES to 360000 and validates overrides", function () {
    assert.equal(new RelayerConfig({}).maxChunkedProofBytes, 360_000);
    assert.equal(new RelayerConfig({ MAX_CHUNKED_PROOF_BYTES: "350000" }).maxChunkedProofBytes, 350_000);
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity"]) {
      assert.throws(() => new RelayerConfig({ MAX_CHUNKED_PROOF_BYTES: value }), "MAX_CHUNKED_PROOF_BYTES");
    }
  });
  it("leaves the chunked relayer unset by default and validates CHUNKED_RELAYER_ADDRESS", function () {
    assert.isUndefined(new RelayerConfig({}).chunkedRelayerAddress);
    assert.isUndefined(new RelayerConfig({ CHUNKED_RELAYER_ADDRESS: "" }).chunkedRelayerAddress);
    const checksummed = "0x52908400098527886E0F7030069857D2E4169EE7";
    assert.equal(
      new RelayerConfig({ CHUNKED_RELAYER_ADDRESS: checksummed.toLowerCase() }).chunkedRelayerAddress,
      checksummed
    );
    for (const value of [
      "0x0000000000000000000000000000000000000000",
      "0x1234",
      "not an address",
      "0x52908400098527886e0F7030069857D2E4169EE7", // bad checksum
    ]) {
      assert.throws(() => new RelayerConfig({ CHUNKED_RELAYER_ADDRESS: value }), "CHUNKED_RELAYER_ADDRESS");
    }
  });
});
