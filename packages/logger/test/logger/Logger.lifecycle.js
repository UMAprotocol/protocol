const { assert } = require("chai");
const sinon = require("sinon");
const winston = require("winston");
const Transport = require("winston-transport");
const { resolvePagerDutyIncident, waitForLogger } = require("../../dist/logger/Logger");
const { PagerDutyV2Transport } = require("../../dist/logger/PagerDutyV2Transport");
const PagerDutyShared = require("../../dist/shared/PagerDutyV2Transport");

describe("Logger lifecycle helpers", function () {
  let sendStub;
  beforeEach(function () {
    sendStub = sinon.stub(PagerDutyShared, "sendPagerDutyEvent").resolves();
  });
  afterEach(function () {
    sendStub.restore();
  });

  it("resolves through the configured PagerDuty route without broadcasting recovery logs", async function () {
    const pd = new PagerDutyV2Transport(
      { level: "error" },
      { integrationKey: "default", customServices: { bot: "custom" } }
    );
    const otherLog = sinon.spy((info, callback) => callback());
    const logger = winston.createLogger({ transports: [pd, new Transport({ log: otherLog })] });
    await resolvePagerDutyIncident(logger, "bot:failure", "bot");
    assert.isTrue(otherLog.notCalled);
    assert.equal(sendStub.firstCall.args[0], "custom");
    assert.deepEqual(sendStub.firstCall.args[1], {
      pagerDutyEventAction: "resolve",
      pagerDutyDedupKey: "bot:failure",
      notificationPath: "bot",
    });
    logger.close();
  });

  it("drains a burst buffered by Winston before sending recovery", async function () {
    const pd = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
    let release;
    sendStub.onFirstCall().returns(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const logger = winston.createLogger({ transports: [pd] });
    for (let i = 0; i < 40; i++) logger.error({ message: "failure", pagerDutyDedupKey: "bot:failure" });
    const recovery = resolvePagerDutyIncident(logger, "bot:failure");
    await new Promise(setImmediate);
    assert.equal(sendStub.callCount, 1);
    release();
    await recovery;
    assert.equal(sendStub.callCount, 41);
    assert.equal(sendStub.lastCall.args[1].pagerDutyEventAction, "resolve");
    logger.close();
  });

  it("rejects a failed recovery so callers can warn and retry", async function () {
    const pd = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route", logTransportErrors: true });
    const logger = winston.createLogger({ transports: [pd] });
    const failure = new Error("delivery failed");
    failure.config = { privateConfiguration: "must not escape" };
    sendStub.rejects(failure);
    let error;
    try {
      await resolvePagerDutyIncident(logger, "bot:failure");
    } catch (caught) {
      error = caught;
    }
    assert.instanceOf(error, Error);
    assert.notProperty(error.originalError, "config");
    logger.close();
  });

  it("delivers later keyed records and recovery after a rejected trigger", async function () {
    const pd = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
    const logger = winston.createLogger({ transports: [pd] });
    const onError = sinon.spy();
    logger.on("error", onError);
    sendStub.onFirstCall().rejects(new Error("trigger failed"));
    for (let i = 0; i < 40; i++) logger.error({ message: "failure", pagerDutyDedupKey: "bot:failure" });
    await resolvePagerDutyIncident(logger, "bot:failure");
    assert.equal(onError.callCount, 1);
    assert.equal(sendStub.callCount, 41);
    assert.equal(sendStub.lastCall.args[1].pagerDutyEventAction, "resolve");
    logger.close();
  });

  it("drains unkeyed buffered records after an earlier unkeyed delivery fails", async function () {
    const pd = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
    const logger = winston.createLogger({ transports: [pd] });
    logger.flushTimeout = 0;
    const onError = sinon.spy();
    logger.on("error", onError);
    let rejectFirst;
    sendStub.onFirstCall().returns(
      new Promise((resolve, reject) => {
        rejectFirst = reject;
      })
    );
    pd.cork();
    for (let i = 0; i < 40; i++) logger.error({ message: `failure ${i}` });
    let done = false;
    const waiting = waitForLogger(logger).then(() => {
      done = true;
    });
    assert.isFalse(pd.isFlushed);
    pd.uncork();
    await new Promise(setImmediate);
    assert.isFalse(done);
    rejectFirst(new Error("unkeyed trigger failed"));
    await waiting;
    assert.equal(onError.callCount, 1);
    assert.equal(sendStub.callCount, 40);
    assert.isTrue(pd.isFlushed);
    logger.error({ message: "later trigger" });
    await waitForLogger(logger);
    assert.equal(sendStub.callCount, 41);
    logger.close();
  });

  it("does not abandon mandatory delivery when the ordinary flush timeout expires", async function () {
    const pd = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
    let release;
    sendStub.onFirstCall().returns(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const logger = winston.createLogger({ transports: [pd] });
    logger.flushTimeout = 0;
    for (let i = 0; i < 40; i++) logger.error({ message: "failure", pagerDutyDedupKey: "bot:failure" });
    let done = false;
    const waiting = waitForLogger(logger).then(() => {
      done = true;
    });
    await new Promise(setImmediate);
    assert.isFalse(done);
    release();
    await waiting;
    assert.equal(sendStub.callCount, 40);
    assert.isTrue(pd.isFlushed);
    logger.close();
  });
});
