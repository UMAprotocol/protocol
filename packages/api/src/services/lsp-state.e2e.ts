require("dotenv").config();
import * as uma from "@uma/sdk";
import assert from "assert";
import { ethers } from "ethers";
import Service from "./lsp-state";
import type { AppState } from "../";
import { Multicall } from "@uma/sdk";
import { lsps } from "../tables";
// this fixes usage of "this" as any
import type Mocha from "mocha";

type Dependencies = Pick<
  AppState,
  "lsps" | "registeredLsps" | "provider" | "collateralAddresses" | "shortAddresses" | "longAddresses" | "multicall"
>;

// first contract launched, does not have pairName property
const registeredContracts = ["0x372802d8A2D69bB43872a1AABe2bd403a0FafA1F"];

describe("lsp-state service", function () {
  let appState: Dependencies;
  before(async function () {
    assert(process.env.CUSTOM_NODE_URL);
    assert(process.env.multicallAddress);
    const provider = new ethers.providers.WebSocketProvider(process.env.CUSTOM_NODE_URL);
    appState = {
      provider,
      multicall: new Multicall(process.env.multicallAddress, provider),
      registeredLsps: new Set<string>(registeredContracts),
      collateralAddresses: new Set<string>(),
      longAddresses: new Set<string>(),
      shortAddresses: new Set<string>(),
      lsps: {
        active: lsps.JsMap("Active LSP"),
        expired: lsps.JsMap("Expired LSP"),
      },
    };
  });
  it("init", async function () {
    const service = Service(undefined, appState);
    assert.ok(service);
  });
  it("readDynamicState", async function () {
    const [address] = registeredContracts;
    const service = Service(undefined, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.batchRead(service.utils.dynamicProps, instance, address);
    assert.equal(result.address, address);
    assert.ok(result.updated > 0);
    assert.ok(result.expiryPrice);
    assert.ok(result.expiryPercentLong);
    assert.ok(result.contractState >= 0);
  });
  it("readStaticState", async function () {
    const [address] = registeredContracts;
    const service = Service(undefined, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.batchRead(service.utils.staticProps, instance, address);
    assert.equal(result.address, address);
    assert.ok(result.updated > 0);
    assert.equal(result.collateralPerPair, "250000000000000000");
    assert.equal(result.priceIdentifier, "UMAUSD");
    assert.equal(result.collateralToken, "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828");
    assert.equal(result.longToken, "0xa1b777a18333A9EC31b4D81f5d08371b6AE1FEb9");
    assert.equal(result.shortToken, "0xeFA3356e054A035dD91fA25b3F2A61484Bc2CD54");
    assert.equal(result.finder, "0x40f941E48A552bF496B154Af6bf55725f18D77c3");
    assert.equal(result.financialProductLibrary, "0x9214454Ff30410a1558b8749Ab3FB0fD6F942539");
    assert.equal(result.customAncillaryData, "0x747761704c656e6774683a33363030");
    assert.equal(result.prepaidProposerReward, "0");
  });
  it("update", async function () {
    this.timeout(60000);
    const service = Service(undefined, appState);
    await service.update();

    assert.ok((await appState.lsps.active.values()).length || (await appState.lsps.expired.values()).length);
    assert.ok([...appState.collateralAddresses.values()].length);
    assert.ok([...appState.longAddresses.values()].length);
    assert.ok([...appState.shortAddresses.values()].length);
  });
});
