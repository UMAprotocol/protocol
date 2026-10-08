import { PagerDutyRecoveryBatch } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import { BigNumber, utils } from "ethers";
import type { OracleRootTunnelEthers } from "@uma/contracts-node";
import type { RequestResolvedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { publishPriceRequest } from "../src/price-publisher/PublishPriceRequest";
import { Logger, MonitoringParams } from "../src/price-publisher/common";

// Only chain I/O is stubbed; the real request handler decides whether to retry, page, or continue.
describe("Price publication recovery", function () {
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });
  afterEach(() => {
    sinon.restore();
    clock.restore();
  });

  function fixture() {
    const queryFilter = sinon.stub().resolves([]);
    const wait = sinon.stub().resolves({ transactionHash: "0x" + "ab".repeat(32), status: 1 });
    const publishPrice = sinon.stub().resolves({ wait });
    const nonce = sinon.stub();
    nonce.onFirstCall().resolves(20);
    nonce.onSecondCall().resolves(23);
    const oracle = ({
      address: "0x" + "12".repeat(20),
      queryFilter,
      filters: { PushedPrice: () => ({}) },
      connect: () => ({ publishPrice }),
    } as unknown) as OracleRootTunnelEthers;
    const logger = ({ transports: [], error: sinon.spy(), warn: sinon.spy() } as unknown) as typeof Logger;
    const params = ({ chainId: 1, signer: { getTransactionCount: nonce } } as unknown) as MonitoringParams;
    const event = ({
      args: {
        identifier: utils.formatBytes32String("YES_OR_NO_QUERY"),
        time: BigNumber.from(1),
        ancillaryData: utils.hexlify(utils.toUtf8Bytes("q:example,childChainId:137")),
        price: BigNumber.from(1),
      },
    } as unknown) as RequestResolvedEvent;
    return {
      queryFilter,
      wait,
      publishPrice,
      nonce,
      oracle,
      logger,
      params,
      event,
      recovery: new PagerDutyRecoveryBatch(logger, "PricePublisher"),
    };
  }

  it("refreshes nonce and checks completion before retrying a rejected submission", async function () {
    const f = fixture();
    const rejected = Object.assign(new Error("nonce has already been used"), {
      code: "NONCE_EXPIRED",
      transactionHash: "0x" + "cd".repeat(32),
    });
    f.publishPrice.onFirstCall().rejects(rejected);
    const result = publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery);
    await clock.runAllAsync();
    assert.isTrue(await result);
    assert.equal(f.publishPrice.firstCall.args[3].nonce, 20);
    assert.equal(f.publishPrice.secondCall.args[3].nonce, 23);
    assert.equal(f.queryFilter.callCount, 2);
    assert.equal((f.logger.error as sinon.SinonSpy).callCount, 0);
  });

  it("does not resubmit when another sender publishes during backoff", async function () {
    const f = fixture();
    f.publishPrice.rejects(
      Object.assign(new Error("replacement transaction underpriced"), { code: "REPLACEMENT_UNDERPRICED" })
    );
    f.queryFilter.onSecondCall().resolves([{}]);
    const result = publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery);
    await clock.runAllAsync();
    assert.isTrue(await result);
    assert.equal(f.publishPrice.callCount, 1);
  });

  it("pages once after bounded nonce retries and permits the next request", async function () {
    const f = fixture();
    f.nonce.resolves(24);
    f.publishPrice.rejects(
      Object.assign(new Error("nonce too low"), { code: "NONCE_EXPIRED", transactionHash: "0x" + "cd".repeat(32) })
    );
    const result = publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery);
    await clock.runAllAsync();
    assert.isFalse(await result);
    assert.equal(f.publishPrice.callCount, 3);
    const errors = f.logger.error as sinon.SinonSpy;
    assert.equal(errors.callCount, 1);
    assert.match(errors.firstCall.args[0].pagerDutyDedupKey, /^price-publisher:1:/);
    f.publishPrice.resolves({ wait: f.wait });
    assert.isTrue(await publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery));
  });

  it("does not resubmit after an ambiguous receipt timeout", async function () {
    const f = fixture();
    f.wait.rejects(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    assert.isFalse(await publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery));
    assert.equal(f.publishPrice.callCount, 1);
    assert.equal((f.logger.error as sinon.SinonSpy).callCount, 1);
  });

  it("accepts positive on-chain recovery after a replaced transaction", async function () {
    const f = fixture();
    f.wait.rejects(Object.assign(new Error("transaction replaced"), { code: "TRANSACTION_REPLACED" }));
    f.queryFilter.onSecondCall().resolves([{}]);
    assert.isTrue(await publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery));
    assert.equal(f.publishPrice.callCount, 1);
    assert.equal((f.logger.error as sinon.SinonSpy).callCount, 0);
  });

  it("does not infer recovery from an RPC failure", async function () {
    const f = fixture();
    f.queryFilter.rejects(new Error("RPC unavailable"));
    assert.isFalse(await publishPriceRequest(f.logger, f.params, f.oracle, f.event, 137, undefined, f.recovery));
    assert.equal(f.publishPrice.callCount, 0);
    assert.equal((f.logger.error as sinon.SinonSpy).callCount, 1);
  });
});
