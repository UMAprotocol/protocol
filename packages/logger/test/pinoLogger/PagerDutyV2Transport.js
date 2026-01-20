const { assert } = require("chai");
const sinon = require("sinon");
const PagerDutyShared = require("../../dist/shared/PagerDutyV2Transport.js");

describe("Pino PagerDutyV2Transport", function () {
  let sendPagerDutyEventStub;
  let createTransport;

  // Helper to write log to Pino transport in correct format (newline-delimited JSON)
  function writeLog(transport, logObj) {
    transport.write(JSON.stringify(logObj) + "\n");
  }

  beforeEach(function () {
    // Stub the shared sendPagerDutyEvent function
    sendPagerDutyEventStub = sinon.stub(PagerDutyShared, "sendPagerDutyEvent").resolves();

    // Dynamically require the transport to ensure fresh module state
    delete require.cache[require.resolve("../../dist/pinoLogger/PagerDutyV2Transport.js")];
    createTransport = require("../../dist/pinoLogger/PagerDutyV2Transport.js").default;
  });

  afterEach(function () {
    sendPagerDutyEventStub.restore();
  });

  describe("Initialization", function () {
    it("Should create transport with valid config", async function () {
      const transport = await createTransport({ integrationKey: "test-key" });
      assert.ok(transport);
      assert.ok(transport.write);
    });

    it("Should throw error for invalid config", async function () {
      try {
        await createTransport({ invalidField: "value" });
        assert.fail("Should have thrown error");
      } catch (error) {
        assert.include(error.message, "Expected a string");
      }
    });
  });

  describe("Log processing", function () {
    it("Should process log with default routing key", async function () {
      const transport = await createTransport({ integrationKey: "default-key" });

      const logLine = {
        level: 50,
        at: "TestModule",
        message: "Test error",
        "bot-identifier": "test-bot",
      };

      // Write the log in Pino format (newline-delimited JSON)
      writeLog(transport, logLine);

      // Give async processing time to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "default-key");
      assert.deepEqual(sendPagerDutyEventStub.firstCall.args[1], logLine);
    });

    it("Should use custom routing key when notificationPath matches", async function () {
      const transport = await createTransport({
        integrationKey: "default-key",
        customServices: {
          "liquidator-error": "liquidator-key",
        },
      });

      const logLine = {
        level: 50,
        at: "TestModule",
        message: "Test error",
        notificationPath: "liquidator-error",
      };

      writeLog(transport, logLine);
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert(sendPagerDutyEventStub.calledOnce);
      assert.equal(sendPagerDutyEventStub.firstCall.args[0], "liquidator-key");
    });

    it("Should process multiple log entries", async function () {
      const transport = await createTransport({ integrationKey: "test-key" });

      const logs = [
        { level: 50, at: "Module1", message: "Error 1" },
        { level: 40, at: "Module2", message: "Warning 1" },
        { level: 50, at: "Module3", message: "Error 2" },
      ];

      logs.forEach((log) => writeLog(transport, log));
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.equal(sendPagerDutyEventStub.callCount, 3);
    });

    it("Should log errors to console when sendPagerDutyEvent fails", async function () {
      sendPagerDutyEventStub.rejects(new Error("API Error"));
      const consoleStub = sinon.stub(console, "error");

      const transport = await createTransport({ integrationKey: "test-key" });

      const logLine = { level: 50, at: "Test", message: "Test" };
      writeLog(transport, logLine);
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert(consoleStub.calledOnce);
      assert.include(consoleStub.firstCall.args[0], "PagerDuty v2 transport error");

      consoleStub.restore();
    });

    it("Should handle logs with numeric levels (Pino format)", async function () {
      const transport = await createTransport({ integrationKey: "test-key" });

      const pinoLog = {
        level: 50, // error
        at: "TestModule",
        message: "Test error",
        timestamp: { seconds: 1234567890, nanos: 123456789 },
        "bot-identifier": "test-bot",
      };

      writeLog(transport, pinoLog);
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert(sendPagerDutyEventStub.calledOnce);
      const receivedLog = sendPagerDutyEventStub.firstCall.args[1];
      assert.equal(receivedLog.level, 50);
      assert.equal(receivedLog.at, "TestModule");
    });
  });
});
