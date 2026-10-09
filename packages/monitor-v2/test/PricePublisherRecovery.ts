import { assert } from "chai";
import sinon from "sinon";
import * as Publisher from "../src/price-publisher/PublishPrices";
import * as Resolver from "../src/price-publisher/ResolvePrices";
import { runPricePublisherCycle } from "../src/price-publisher/RunCycle";
import { Logger, MonitoringParams } from "../src/price-publisher/common";

// Regression: constructing all command promises at once starts publish before resolve completes.
describe("Price publisher command ordering", function () {
  afterEach(() => sinon.restore());

  it("waits for resolution before starting publication", async function () {
    let finishResolution!: () => void;
    const order: string[] = [];
    sinon.stub(Resolver, "resolvePrices").callsFake(async () => {
      order.push("resolve-start");
      await new Promise<void>((resolve) => {
        finishResolution = resolve;
      });
      order.push("resolve-end");
    });
    sinon.stub(Publisher, "publishPrices").callsFake(async () => {
      order.push("publish");
    });
    const cycle = runPricePublisherCycle(Logger, {
      botModes: { resolvePricesEnabled: true, publishPricesEnabled: true },
    } as MonitoringParams);
    assert.deepEqual(order, ["resolve-start"]);
    finishResolution();
    await cycle;
    assert.deepEqual(order, ["resolve-start", "resolve-end", "publish"]);
  });

  it("does not publish when the prerequisite resolution scan fails", async function () {
    const failure = new Error("RPC unavailable");
    sinon.stub(Resolver, "resolvePrices").rejects(failure);
    const publish = sinon.stub(Publisher, "publishPrices").resolves();
    let caught;
    try {
      await runPricePublisherCycle(Logger, {
        botModes: { resolvePricesEnabled: true, publishPricesEnabled: true },
      } as MonitoringParams);
    } catch (error) {
      caught = error;
    }
    assert.strictEqual(caught, failure);
    assert.isFalse(publish.called);
  });
});
