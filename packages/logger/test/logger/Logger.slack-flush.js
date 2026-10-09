const { assert } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const winston = require("winston");
const { waitForLogger } = require("../../dist/logger/Logger");
const { PersistentTransport } = require("../../dist/logger/PersistentTransport");

describe("Logger: bounded Slack shutdown", function () {
  let clock;
  let post;
  let logger;

  beforeEach(function () {
    clock = sinon.useFakeTimers();
    post = sinon.stub().resolves({ status: 200 });
    sinon.stub(axios, "create").returns({ post });
    delete require.cache[require.resolve("../../dist/logger/SlackTransport")];
    const { createSlackTransport } = require("../../dist/logger/SlackTransport");
    logger = winston.createLogger({
      transports: [createSlackTransport({ defaultWebHookUrl: "https://slack.test/shutdown" })],
    });
    logger.flushTimeout = 0;
    logger.mandatoryFlushTimeout = 5;
  });

  afterEach(function () {
    logger.close();
    sinon.restore();
    clock.restore();
    delete require.cache[require.resolve("../../dist/logger/SlackTransport")];
  });

  it("waits for queued Slack messages after the ordinary timeout", async function () {
    logger.info({ at: "Test", message: "first" });
    logger.info({ at: "Test", message: "second" });
    let finished = false;
    const waiting = waitForLogger(logger).then(() => (finished = true));
    await clock.tickAsync(999);
    assert.isFalse(finished);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(101);
    await waiting;
    assert.equal(post.callCount, 2);
    assert.isTrue(logger.transports[0].isFlushed);
  });

  it("reports pending delivery and returns at the mandatory deadline", async function () {
    let release;
    post.onFirstCall().returns(new Promise((resolve) => (release = resolve)));
    const consoleError = sinon.stub(console, "error");
    logger.mandatoryFlushTimeout = 1;
    logger.info({ at: "Test", message: "pending" });
    let finished = false;
    const waiting = waitForLogger(logger).then(() => (finished = true));
    await clock.tickAsync(999);
    assert.isFalse(finished);
    await clock.tickAsync(1);
    await waiting;
    assert.isFalse(logger.transports[0].isFlushed);
    assert.isTrue(consoleError.calledOnce);
    release({ status: 200 });
    await clock.tickAsync(0);
  });

  it("stops dequeuing persistent records at the ordinary deadline while Slack is pending", async function () {
    let finishPersistent;
    let finishSlack;
    const delivered = [];
    class QueuedTransport extends PersistentTransport {
      async logQueueElement(info) {
        delivered.push(info.message);
        if (info.message === "first") await new Promise((resolve) => (finishPersistent = resolve));
      }
    }
    // Silence new writes: only the already-persisted backlog is relevant to shutdown.
    const persistent = new QueuedTransport({ silent: true }, "test");
    const pop = sinon.stub(persistent, "rateLimitedPopWithStatus");
    pop.onCall(0).resolves({ status: "ready", item: JSON.stringify({ message: "first" }) });
    pop.onCall(1).resolves({ status: "ready", item: JSON.stringify({ message: "second" }) });
    pop.resolves({ status: "empty" });
    logger.add(persistent);
    const processing = persistent.processLogQueue();
    post.onFirstCall().returns(new Promise((resolve) => (finishSlack = resolve)));
    logger.info({ at: "Test", message: "Slack still pending" });
    logger.flushTimeout = 1;
    let finished = false;
    const waiting = waitForLogger(logger).then(() => (finished = true));
    await clock.tickAsync(1000);
    assert.deepEqual(delivered, ["first"]);
    assert.isFalse(finished);
    finishPersistent();
    await clock.tickAsync(0);
    await processing;
    assert.deepEqual(delivered, ["first"], "leave the next record persisted during the Slack drain");
    assert.isFalse(finished, "Slack must still be drained after persistent processing stops");
    finishSlack({ status: 200 });
    await clock.tickAsync(50);
    await waiting;
  });

  it("includes records still buffered upstream of the Slack transport", async function () {
    const slack = logger.transports[0];
    slack.cork();
    for (let i = 0; i < 40; i++) logger.info({ at: "Test", message: `message ${i}` });
    logger.mandatoryFlushTimeout = 60;
    let finished = false;
    const waiting = waitForLogger(logger).then(() => (finished = true));
    await clock.tickAsync(100);
    assert.isFalse(finished);
    assert.equal(post.callCount, 0);
    slack.uncork();
    await clock.tickAsync(40000);
    await waiting;
    assert.equal(post.callCount, 40);
    assert.isTrue(slack.isFlushed);
  });
});
