import dotenv from "dotenv";
import assert from "assert";
import Events from "events";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/providers";
import { Erc20, Erc20Service } from "../erc20";
import { MULTICALL2_ADDRESS } from "../../constants";

dotenv.config();

const wethAddress = "0x7355Efc63Ae731f584380a9838292c7046c1e433";
const account = "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D";
const spender = "0x57C891D01605d456bBEa535c8E56EaAc4E2DFE11";

describe("Erc20 E2E", function () {
  let provider: Provider;
  let erc20: Erc20;
  let erc20Service: Erc20Service;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    erc20 = new Erc20(wethAddress, MULTICALL2_ADDRESS, provider);
    erc20Service = new Erc20Service(wethAddress, MULTICALL2_ADDRESS, provider);
  });
  describe("Erc20", function () {
    beforeAll(async () => {
      erc20 = new Erc20(wethAddress, MULTICALL2_ADDRESS, provider);
    });
    test("getProps", async function () {
      jest.setTimeout(30000);
      const result = await erc20.getProps();
      assert.ok(result.symbol);
      assert.ok(result.name);
      assert.ok(result.decimals);
      assert.ok(result.totalSupply.toString());
    });
  });
  describe("Erc20Service", function () {
    const events = new Events();
    beforeAll(async () => {
      erc20Service = new Erc20Service(wethAddress, MULTICALL2_ADDRESS, provider, events.emit.bind(events));
    });
    test("getProps", async function (done) {
      jest.setTimeout(30000);
      events.once("getProps", (result, args) => {
        assert.ok(result.symbol);
        assert.ok(result.name);
        assert.ok(result.decimals);
        assert.ok(result.totalSupply.toString());
        assert.equal(args.length, 0);
        done();
      });
      await erc20Service.getProps();
    });
    test("getBalance", async function (done) {
      events.once("getBalance", (result, args) => {
        assert.ok(result.toString());
        assert.equal(args[0], account);
        done();
      });
      await erc20Service.getBalance(account);
    });
    test("getAllowance", async function (done) {
      events.once("getAllowance", (result, args) => {
        assert.ok(result.toString());
        assert.equal(args[0], account);
        assert.equal(args[1], spender);
        done();
      });
      await erc20Service.getAllowance(account, spender);
    });
  });
});
