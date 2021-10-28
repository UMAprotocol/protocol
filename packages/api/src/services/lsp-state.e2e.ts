require("dotenv").config();
import * as uma from "@uma/sdk";
import assert from "assert";
import { ethers } from "ethers";
import { LspState as Service } from "./lsp-state";
import type { AppClients, AppState } from "../types";
import { Multicall2 } from "@uma/sdk";
import * as tables from "../tables";
// this fixes usage of "this" as any
import "mocha";

type Dependencies = {
  tables: Pick<AppState, "lsps" | "registeredLsps" | "collateralAddresses" | "shortAddresses" | "longAddresses">;
  appClients: Pick<AppClients, "provider" | "multicall2">;
};

// this contract updated to have pairName                                 // does not have pairname
const registeredContracts = [
  "0x6B435F5C417d1D058683E2B175d8396F09f2186d",
  "0x372802d8A2D69bB43872a1AABe2bd403a0FafA1F",
];

describe("lsp-state service", function () {
  let dependencies: Dependencies;

  before(async function () {
    assert(process.env.CUSTOM_NODE_URL);
    assert(process.env.MULTI_CALL_2_ADDRESS);
    const provider = new ethers.providers.WebSocketProvider(process.env.CUSTOM_NODE_URL);
    const registeredLsps = tables.registeredContracts.Table("Registered Lsps");
    await Promise.all(registeredContracts.map((address) => registeredLsps.set({ address, id: address })));
    dependencies = {
      tables: {
        registeredLsps,
        collateralAddresses: tables.addresses.Table("Collateral Addresses"),
        longAddresses: tables.addresses.Table("Long Addresses"),
        shortAddresses: tables.addresses.Table("Short Addresses"),
        lsps: {
          active: tables.lsps.Table("Active LSP"),
          expired: tables.lsps.Table("Expired LSP"),
        },
      },
      appClients: {
        provider,
        multicall2: new Multicall2(process.env.MULTI_CALL_2_ADDRESS, provider),
      },
    };
  });
  it("init", async function () {
    const service = Service({}, dependencies);
    assert.ok(service);
  });
  it("get collateral balance", async function () {
    const collateralAddress = "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828";
    const service = Service({}, dependencies);
    const [address] = registeredContracts;
    const result = await service.utils.getErc20BalanceOf(collateralAddress, address);
    assert.ok(result);
  });
  it("getPositionCollateral", async function () {
    const service = Service({}, dependencies);
    const [address] = registeredContracts;
    const instance = await uma.clients.lsp.connect(address, dependencies.appClients.provider);
    const result = await service.utils.getPositionCollateral(instance, address);
    assert.ok(result);
  });
  it("readDynamicState", async function () {
    const { appClients } = dependencies;
    const [address] = registeredContracts;
    const service = Service({}, dependencies);
    const instance = await uma.clients.lsp.connect(address, appClients.provider);
    const result = await service.utils.getDynamicProps(instance, address);
    assert.equal(result.address, address);
    assert.ok(result.updated > 0);
    assert.ok(result.expiryPrice);
    assert.ok(result.expiryPercentLong);
    assert.ok(result.contractState >= 0);
  });
  it("readOptionalState", async function () {
    const { appClients } = dependencies;
    const [address] = registeredContracts;
    const service = Service({}, dependencies);
    const instance = await uma.clients.lsp.connect(address, appClients.provider);
    const result = await service.utils.getOptionalProps(instance, address);
    assert.equal(result.pairName, "SUSHIsBOND July 2024");
  });
  it("readStaticState", async function () {
    const { appClients } = dependencies;
    const [address] = registeredContracts;
    const service = Service({}, dependencies);
    const instance = await uma.clients.lsp.connect(address, appClients.provider);
    const result = await service.utils.getStaticProps(instance, address);
    assert.equal(result.address, address);
    assert.ok(result.updated > 0);
    assert.equal(result.collateralPerPair, "200000000000000000000");
    assert.equal(result.priceIdentifier, "SUSHIUSD");
    assert.equal(result.collateralToken, "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2");
    assert.equal(result.longToken, "0x9c728BAD65cCED25B7F03fB47dCB4AB1d3F2b431");
    assert.equal(result.shortToken, "0x29c71D66De780396677ddEe87af7261e2Ef34306");
    assert.equal(result.finder, "0x40f941E48A552bF496B154Af6bf55725f18D77c3");
    assert.equal(result.financialProductLibrary, "0x5a116B8bAb914513F710085cAd0f4628Dcc7eeca");
    assert.equal(result.customAncillaryData, "0x747761704c656e6774683a33363030");
    assert.equal(result.expirationTimestamp, "1722441600");
    assert.equal(result.proposerReward, "0");
  });
  it("update", async function () {
    this.timeout(60000);
    const service = Service({}, dependencies);
    await service.update();
    const { tables } = dependencies;
    assert.ok((await tables.lsps.active.values()).length || (await tables.lsps.expired.values()).length);
    assert.ok([...(await tables.collateralAddresses.keys())].length);
    assert.ok([...(await tables.longAddresses.keys())].length);
    assert.ok([...(await tables.shortAddresses.keys())].length);
  });
});
