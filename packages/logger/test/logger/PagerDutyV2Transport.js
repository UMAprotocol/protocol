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
        {
          integrationKey: "test-key",
          customServices: { path1: "key1" },
          logTransportErrors: true,
        }
      );

      assert.equal(transport.integrationKey, "test-key");
      assert.deepEqual(transport.customServices, { path1: "key1" });
      assert.equal(transport.logTransportErrors, true);
    });
  });

  describe("log method", function () {
    it("Should send event with default routing key", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "default-key" });

      const info = {
        level: "error",
        at: "TestModule",
        message: "Test error",
      };

      await new Promise((resolve) => {
        transport.log(info, resolve);
      });

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "default-key");
      assert.deepEqual(sendPagerDutyEventStub.firstCall.args[1], info);
    });

    it("Should use custom routing key when notificationPath matches", async function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        {
          integrationKey: "default-key",
          customServices: {
            "liquidator-error": "liquidator-key",
            "monitor-alert": "monitor-key",
          },
        }
      );

      const info = {
        level: "error",
        at: "TestModule",
        message: "Test error",
        notificationPath: "liquidator-error",
      };

      await new Promise((resolve) => {
        transport.log(info, resolve);
      });

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "liquidator-key");
    });

    it("Should use default routing key when notificationPath doesn't match", async function () {
      const transport = new PagerDutyV2Transport(
        { level: "error" },
        {
          integrationKey: "default-key",
          customServices: { "known-path": "custom-key" },
        }
      );

      const info = {
        level: "error",
        at: "TestModule",
        message: "Test error",
        notificationPath: "unknown-path",
      };

      await new Promise((resolve) => {
        transport.log(info, resolve);
      });

      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "default-key");
    });

    it("Should call callback on success", async function () {
      const transport = new PagerDutyV2Transport({ level: "error" }, { integrationKey: "test-key" });

      const callback = sinon.spy();
      await transport.log({ level: "error", at: "Test", message: "Test" }, callback);

      assert(callback.calledOnce);
      assert(callback.calledWith());
    });

    it("Should return TransportError in callback when error occurs and logTransportErrors is false", async function () {
      sendPagerDutyEventStub.rejects(new Error("API Error"));

      const transport = new PagerDutyV2Transport(
        { level: "error" },
        { integrationKey: "test-key", logTransportErrors: false }
      );

      const callback = sinon.spy();
      const info = { level: "error", at: "Test", message: "Test" };

      await transport.log(info, callback);

      assert(callback.calledOnce);
      const error = callback.firstCall.args[0];
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
});
