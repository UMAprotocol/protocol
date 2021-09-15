require("dotenv").config();
import * as uma from "@uma/sdk";
import assert from "assert";
import { ethers } from "ethers";
import Service from "./lsp-state";
import type { AppState } from "../";
import { Multicall } from "@uma/sdk";
import { lsps } from "../tables";
// this fixes usage of "this" as any
import "mocha";

type Dependencies = Pick<
  AppState,
  | "lsps"
  | "registeredLsps"
  | "provider"
  | "collateralAddresses"
  | "shortAddresses"
  | "longAddresses"
  | "multicall"
  | "registeredLspsMetadata"
>;

// this contract updated to have pairName                                 // does not have pairname
const registeredContracts = [
  "0x6B435F5C417d1D058683E2B175d8396F09f2186d",
  "0x372802d8A2D69bB43872a1AABe2bd403a0FafA1F",
];

describe("lsp-state service", function () {
  let appState: Dependencies;
  before(async function () {
    assert(process.env.CUSTOM_NODE_URL);
    assert(process.env.MULTI_CALL_ADDRESS);
    const provider = new ethers.providers.WebSocketProvider(process.env.CUSTOM_NODE_URL);
    appState = {
      provider,
      multicall: new Multicall(process.env.MULTI_CALL_ADDRESS, provider),
      registeredLsps: new Set<string>(registeredContracts),
      collateralAddresses: new Set<string>(),
      longAddresses: new Set<string>(),
      shortAddresses: new Set<string>(),
      lsps: {
        active: lsps.JsMap("Active LSP"),
        expired: lsps.JsMap("Expired LSP"),
      },
      registeredLspsMetadata: new Map(),
    };
  });
  it("init", async function () {
    const service = Service({}, appState);
    assert.ok(service);
  });
  it("get collateral balance", async function () {
    const collateralAddress = "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828";
    const service = Service({}, appState);
    const [address] = registeredContracts;
    const result = await service.utils.getErc20BalanceOf(collateralAddress, address);
    assert.ok(result);
  });
  it("getPositionCollateral", async function () {
    const service = Service({}, appState);
    const [address] = registeredContracts;
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.getPositionCollateral(instance, address);
    assert.ok(result);
  });
  it("readDynamicState", async function () {
    const [address] = registeredContracts;
    const service = Service({}, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.getDynamicProps(instance, address);
    assert.equal(result.address, address);
    assert.ok(result.updated > 0);
    assert.ok(result.expiryPrice);
    assert.ok(result.expiryPercentLong);
    assert.ok(result.contractState >= 0);
  });
  it("readOptionalState", async function () {
    const [address] = registeredContracts;
    const service = Service({}, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.getOptionalProps(instance, address);
    assert.equal(result.pairName, "SUSHIsBOND July 2024");
  });
  it("readStaticState", async function () {
    const [address] = registeredContracts;
    const service = Service({}, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
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
    assert.equal(result.prepaidProposerReward, "0");
  });
  it("update", async function () {
    this.timeout(60000);
    const service = Service({}, appState);
    await service.update();

    assert.ok((await appState.lsps.active.values()).length || (await appState.lsps.expired.values()).length);
    assert.ok([...appState.collateralAddresses.values()].length);
    assert.ok([...appState.longAddresses.values()].length);
    assert.ok([...appState.shortAddresses.values()].length);
  });
});
