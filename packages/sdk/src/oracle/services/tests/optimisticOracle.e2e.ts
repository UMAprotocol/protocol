import dotenv from "dotenv";
import assert from "assert";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/providers";
import { OptimisticOracle } from "../optimisticOracle";

dotenv.config();

// mainnet test only
const ooAddress = "0xC43767F4592DF265B4a9F1a398B97fF24F38C6A6";
const request = {
  requester: "0x863E77B0bFC12193d2f5D41cdcacE81f1bb5a09F",
  identifier: "0x47656e6572616c5f4b5049000000000000000000000000000000000000000000",
  timestamp: 1639752300,
  ancillaryData:
    "0x4d65747269633a54564c20696e204250524f2066696e616e6369616c20636f6e747261637473206d6561737572656420696e205553442c456e64706f696e743a2268747470733a2f2f6170692e6c6c616d612e66692f70726f746f636f6c2f422e50726f746f636f6c222c4d6574686f643a2268747470733a2f2f6769746875622e636f6d2f554d4170726f746f636f6c2f554d4950732f626c6f622f6d61737465722f496d706c656d656e746174696f6e732f6270726f746f636f6c2d74766c2e6d64222c4b65793a746f74616c4c69717569646974795553442c496e74657276616c3a4461696c792c526f756e64696e673a302c5363616c696e673a30",
};

describe("OptimisticOracle Service", function () {
  let provider: Provider;
  let oo: OptimisticOracle;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL, 1);
    oo = new OptimisticOracle(provider, ooAddress, 1);
  });
  test("update", async function () {
    await oo.update();
  });
  test("getProps", async function () {
    const result = await oo.getProps();
    assert.ok(result.defaultLiveness);
  });
  test("getRequest", async function () {
    const result = await oo.getRequest(request);
    assert.ok(result);
    assert.equal(result.state, 6);
  });
});
