const { assert } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const winston = require("winston");
const { waitForLogger } = require("../../dist/logger/Logger");

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
