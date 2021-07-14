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
    assert.ok(result.address);
    assert.ok(result.updated);
    assert.ok(result.expiryPrice);
    assert.ok(result.expiryPercentLong);
    assert.ok(result.expirationTimestamp);
    assert.ok(result.contractState >= 0);
  });
  it("readStaticState", async function () {
    const [address] = registeredContracts;
    const service = Service(undefined, appState);
    const instance = await uma.clients.lsp.connect(address, appState.provider);
    const result = await service.utils.batchRead(service.utils.staticProps, instance, address);
    assert.ok(result.address);
    assert.ok(result.updated);
    assert.ok(result.collateralPerPair);
    assert.ok(result.priceIdentifier);
    assert.ok(result.collateralToken);
    assert.ok(result.longToken);
    assert.ok(result.shortToken);
    assert.ok(result.finder);
    assert.ok(result.financialProductLibrary);
    assert.ok(result.customAncillaryData);
    assert.ok(result.prepaidProposerReward);
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
