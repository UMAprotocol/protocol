import dotenv from "dotenv";
import assert from "assert";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/providers";
import { SkinnyOptimisticOracle } from "../skinnyOptimisticOracle";

dotenv.config();

// mainnet test only
const ooAddress = "0xeE3Afe347D5C74317041E2618C49534dAf887c24";
const request = {
  requester: "0x7355Efc63Ae731f584380a9838292c7046c1e433",
  identifier: "0x49535f52454c41595f56414c4944000000000000000000000000000000000000",
  timestamp: 1654874916,
  ancillaryData:
    "0x72656c6179486173683a30313634323935643530393533613431323231363131343761623233303231343166306438636132613730373461303733373537626631626365656165663739",
};

describe("Skinny Oracle Service", function () {
  let provider: Provider;
  let oo: SkinnyOptimisticOracle;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL, 1);
    oo = new SkinnyOptimisticOracle(provider, ooAddress, 1);
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
