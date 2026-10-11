const { assert } = require("chai");
const sinon = require("sinon");
const { PagerDutyV2Transport } = require("../../dist/logger/PagerDutyV2Transport.js");
const PagerDutyShared = require("../../dist/shared/PagerDutyV2Transport.js");

describe("Winston PagerDutyV2Transport", function () {
  let sendPagerDutyEventStub;

  beforeEach(function () {
    // Stub the shared sendPagerDutyEvent function
    sendPagerDutyEventStub = sinon.stub(PagerDutyShared, "sendPagerDutyEvent").resolves();
  });

  afterEach(function () {
    sendPagerDutyEventStub.restore();
  });

  describe("Initialization", function () {
    it("Should create transport with required config", function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "test-key" });

      assert.equal(transport.integrationKey, "test-key");
      assert.deepEqual(transport.customServices, {});
      assert.equal(transport.logTransportErrors, false);
    });

    it("Should create transport with full config", function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "test-key", customServices: { path1: "key1" }, logTransportErrors: true }
      );

      assert.equal(transport.integrationKey, "test-key");
      assert.deepEqual(transport.customServices, { path1: "key1" });
      assert.equal(transport.logTransportErrors, true);
    });
  });

  describe("log method", function () {
    it("Should send event with default routing key", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "default-key" });

      const info = { level: "error", at: "TestModule", message: "Test error" };

      transport.log(info, () => {});
      await transport.flush();

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "default-key");
      assert.deepEqual(sendPagerDutyEventStub.firstCall.args[1], info);
    });

    it("Should use custom routing key when notificationPath matches", async function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        {
          integrationKey: "default-key",
          customServices: { "liquidator-error": "liquidator-key", "monitor-alert": "monitor-key" },
        }
      );

      const info = { level: "error", at: "TestModule", message: "Test error", notificationPath: "liquidator-error" };

      transport.log(info, () => {});
      await transport.flush();

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "liquidator-key");
    });

    it("Should use default routing key when notificationPath doesn't match", async function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "default-key", customServices: { "known-path": "custom-key" } }
      );

      const info = { level: "error", at: "TestModule", message: "Test error", notificationPath: "unknown-path" };

      transport.log(info, () => {});
      await transport.flush();

      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "default-key");
    });

    it("acknowledges admission before remote delivery and waits for flush", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "test-key" });

      let release;
      sendPagerDutyEventStub.returns(
        new Promise((resolve) => {
          release = resolve;
        })
      );
      const callback = sinon.spy();
      const delivery = transport.log({ level: "error", at: "Test", message: "Test" }, callback);
      assert(callback.calledOnce);
      assert(callback.calledWithExactly());
      assert.isFalse(transport.isFlushed);
      release();
      await delivery;
      await transport.flush();
      assert.isTrue(transport.isFlushed);
    });

    it("emits TransportError after admission when logTransportErrors is false", async function () {
      sendPagerDutyEventStub.rejects(new Error("API Error"));

      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "test-key", logTransportErrors: false }
      );

      const callback = sinon.spy();
      const onError = sinon.spy();
      transport.on("error", onError);
      const info = { level: "error", at: "Test", message: "Test" };

      await transport.log(info, callback);

      assert(callback.calledOnce);
      assert(callback.calledWithExactly());
      assert(onError.calledOnce);
      const error = onError.firstCall.args[0];
      assert(error);
      assert.include(error.message, "PagerDuty V2");
    });

    it("Should log to console when error occurs and logTransportErrors is true", async function () {
      sendPagerDutyEventStub.rejects(new Error("API Error"));
      const consoleStub = sinon.stub(console, "error");

      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "test-key", logTransportErrors: true }
      );

      const callback = sinon.spy();
      await transport.log({ level: "error", at: "Test", message: "Test" }, callback);

      assert(consoleStub.calledOnce);
      assert.include(consoleStub.firstCall.args[0], "PagerDuty v2 error");
      assert(callback.calledWith());

      consoleStub.restore();
    });
  });
  describe("incident lifecycle", function () {
    it("orders matching triggers and resolves and drains both", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
      let finishTrigger;
      sendPagerDutyEventStub.onFirstCall().returns(
        new Promise((resolve) => {
          finishTrigger = resolve;
        })
      );
      const trigger = transport.log({ level: "error", pagerDutyDedupKey: "bot:failure" }, () => {});
      const recovery = transport.log({ pagerDutyEventAction: "resolve", pagerDutyDedupKey: "bot:failure" }, () => {});
      await new Promise(setImmediate);
      assert.equal(sendPagerDutyEventStub.callCount, 1);
      assert.isFalse(transport.isFlushed);
      let drained = false;
      const flush = transport.flush().then(() => {
        drained = true;
      });
      await new Promise(setImmediate);
      assert.isFalse(drained);
      finishTrigger();
      await Promise.all([trigger, recovery, flush]);
      assert.equal(sendPagerDutyEventStub.callCount, 2);
      assert.equal(sendPagerDutyEventStub.secondCall.args[1].pagerDutyEventAction, "resolve");
      assert.isTrue(transport.isFlushed);
    });

    it("does not serialize different incident keys", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "route" });
      let finishFirst;
      sendPagerDutyEventStub.onFirstCall().returns(
        new Promise((resolve) => {
          finishFirst = resolve;
        })
      );
      const first = transport.log({ level: "error", pagerDutyDedupKey: "first" }, () => {});
      await new Promise(setImmediate);
      await transport.log({ level: "error", pagerDutyDedupKey: "second" }, () => {});
      assert.equal(sendPagerDutyEventStub.callCount, 2);
      finishFirst();
      await first;
    });

    it("continues after a failed trigger and rejects failed direct recovery", async function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "route", logTransportErrors: true }
      );
      sendPagerDutyEventStub.onFirstCall().rejects(new Error("trigger failed"));
      const consoleStub = sinon.stub(console, "error");
      try {
        await transport.log({ level: "error", pagerDutyDedupKey: "bot:failure" }, () => {});
        await transport.resolveIncident("bot:failure");
        sendPagerDutyEventStub.rejects(new Error("resolve failed"));
        let error;
        try {
          await transport.resolveIncident("bot:failure");
        } catch (caught) {
          error = caught;
        }
        assert.instanceOf(error, Error);
        assert.isTrue(transport.isFlushed);
      } finally {
        consoleStub.restore();
      }
    });
  });
});
