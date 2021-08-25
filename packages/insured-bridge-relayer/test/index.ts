import winston from "winston";
import sinon from "sinon";
import { run } from "../src/index";

const { web3 } = require("hardhat");

import { SpyTransport } from "@uma/financial-templates-lib";

describe("index.js", function () {
  let spyLogger: any;
  let spy: any;
  let originalEnv: any;

  after(async function () {
    process.env = originalEnv;
  });
  before(async function () {
    originalEnv = process.env;
  });

  beforeEach(async function () {
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
  });

  it("Runs with no errors", async function () {
    process.env.BRIDGE_POOL_FACTORY_ADDRESS = "0x0000000000000000000000000000000000000000";

    process.env.POLLING_DELAY = "0";

    // Must not throw.
    await run(spyLogger, web3);
  });
});
