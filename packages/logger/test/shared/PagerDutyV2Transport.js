const { assert } = require("chai");
const sinon = require("sinon");
const pdEvents = require("@pagerduty/pdjs/build/src/events");
const {
  createConfig,
  convertLevelToSeverity,
  sendPagerDutyEvent,
} = require("../../dist/shared/PagerDutyV2Transport.js");

describe("PagerDuty V2 Shared Utilities", function () {
  describe("createConfig", function () {
    it("Should create valid config with required fields", function () {
      const config = createConfig({ integrationKey: "test-key-123" });
      assert.equal(config.integrationKey, "test-key-123");
      assert.deepEqual(config.customServices, undefined);
      assert.equal(config.logTransportErrors, undefined);
    });

    it("Should create valid config with all fields", function () {
      const config = createConfig({
        integrationKey: "test-key-123",
        customServices: { path1: "key1", path2: "key2" },
        logTransportErrors: true,
      });
      assert.equal(config.integrationKey, "test-key-123");
      assert.deepEqual(config.customServices, { path1: "key1", path2: "key2" });
      assert.equal(config.logTransportErrors, true);
    });

    it("Should throw error for missing integrationKey", function () {
      assert.throws(() => createConfig({}), /Expected a string/);
    });

    it("Should throw error for invalid integrationKey type", function () {
      assert.throws(() => createConfig({ integrationKey: 123 }), /Expected a string/);
    });

    it("Should throw error for invalid customServices type", function () {
      assert.throws(
        () => createConfig({ integrationKey: "test-key", customServices: "invalid" }),
        /Expected an object/
      );
    });
  });

  describe("convertLevelToSeverity", function () {
    describe("Winston string levels", function () {
      it("Should convert error to error", function () {
        assert.equal(convertLevelToSeverity("error"), "error");
      });

      it("Should convert warn to warning", function () {
        assert.equal(convertLevelToSeverity("warn"), "warning");
      });

      it("Should convert info to info", function () {
        assert.equal(convertLevelToSeverity("info"), "info");
      });

      it("Should convert debug to info (lowest severity)", function () {
        assert.equal(convertLevelToSeverity("debug"), "info");
      });

      it("Should convert fatal to critical", function () {
        assert.equal(convertLevelToSeverity("fatal"), "critical");
      });

      it("Should convert critical to critical", function () {
        assert.equal(convertLevelToSeverity("critical"), "critical");
      });

      it("Should handle uppercase levels", function () {
        assert.equal(convertLevelToSeverity("ERROR"), "error");
        assert.equal(convertLevelToSeverity("WARN"), "warning");
      });

      it("Should handle undefined level", function () {
        assert.equal(convertLevelToSeverity(undefined), "info");
      });
    });

    describe("Pino numeric levels", function () {
      it("Should convert 60 (fatal) to critical", function () {
        // Pino levels.labels[60] = "fatal" which maps to "critical"
        assert.equal(convertLevelToSeverity(60), "critical");
      });

      it("Should convert 50 (error) to error", function () {
        // Pino levels.labels[50] = "error" which maps to "error"
        assert.equal(convertLevelToSeverity(50), "error");
      });

      it("Should convert 40 (warn) to warning", function () {
        // Pino levels.labels[40] = "warn" which maps to "warning"
        assert.equal(convertLevelToSeverity(40), "warning");
      });

      it("Should convert 30 (info) to info", function () {
        // Pino levels.labels[30] = "info" which maps to "info"
        assert.equal(convertLevelToSeverity(30), "info");
      });

      it("Should convert 20 (debug) to info (lowest severity)", function () {
        // Pino levels.labels[20] = "debug" which maps to "info" (lowest PD severity)
        assert.equal(convertLevelToSeverity(20), "info");
      });

      it("Should convert 10 (trace) to info (lowest severity)", function () {
        // Pino levels.labels[10] = "trace" which maps to "info" (lowest PD severity)
        assert.equal(convertLevelToSeverity(10), "info");
      });
    });
  });

  describe("sendPagerDutyEvent lifecycle", function () {
    let eventStub;
    beforeEach(function () {
      eventStub = sinon.stub(pdEvents, "event").resolves({ ok: true, status: 202 });
    });
    afterEach(function () {
      eventStub.restore();
    });

    it("preserves ordinary triggers without a deduplication key", async function () {
      await sendPagerDutyEvent("route", { level: "error", at: "Bot", message: "Failure" });
      const { data } = eventStub.firstCall.args[0];
      assert.equal(data.event_action, "trigger");
      assert.notProperty(data, "dedup_key");
      assert.equal(data.payload.summary, "error: Bot ⭢ Failure");
    });

    it("adds the stable key to opt-in triggers", async function () {
      await sendPagerDutyEvent("route", {
        level: "error",
        at: "Bot",
        message: "Failure",
        pagerDutyDedupKey: "bot:failure",
      });
      assert.equal(eventStub.firstCall.args[0].data.dedup_key, "bot:failure");
      assert.equal(eventStub.firstCall.args[0].data.event_action, "trigger");
    });

    it("sends only routing, action, and deduplication key for recovery", async function () {
      await sendPagerDutyEvent("route", { pagerDutyEventAction: "resolve", pagerDutyDedupKey: "bot:failure" });
      assert.deepEqual(eventStub.firstCall.args[0].data, {
        routing_key: "route",
        event_action: "resolve",
        dedup_key: "bot:failure",
      });
    });

    it("rejects missing or invalid recovery keys and unsupported actions before sending", async function () {
      for (const fields of [
        { pagerDutyEventAction: "resolve" },
        { pagerDutyDedupKey: "" },
        { pagerDutyDedupKey: "   " },
        { pagerDutyDedupKey: 123 },
        { pagerDutyDedupKey: "x".repeat(256) },
        { pagerDutyDedupKey: "é".repeat(128) },
        { pagerDutyEventAction: "acknowledge" },
        { pagerDutyEventAction: null },
      ]) {
        let error;
        try {
          await sendPagerDutyEvent("route", fields);
        } catch (caught) {
          error = caught;
        }
        assert.instanceOf(error, Error);
      }
      assert.isTrue(eventStub.notCalled);
    });

    it("accepts a 255-byte key", async function () {
      await sendPagerDutyEvent("route", { pagerDutyEventAction: "resolve", pagerDutyDedupKey: "x".repeat(255) });
      assert.isTrue(eventStub.calledOnce);
    });

    it("aborts a hanging request after 30 seconds and disables the ineffective pdjs timer", async function () {
      const clock = sinon.useFakeTimers();
      try {
        eventStub.callsFake(
          ({ signal }) =>
            new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
            })
        );
        const delivery = sendPagerDutyEvent("route", {
          pagerDutyEventAction: "resolve",
          pagerDutyDedupKey: "bot:failure",
        });
        const result = delivery.then(
          () => undefined,
          (error) => error
        );
        const request = eventStub.firstCall.args[0];
        assert.equal(request.requestTimeout, 0);
        await clock.tickAsync(29999);
        assert.isFalse(request.signal.aborted);
        await clock.tickAsync(1);
        assert.isTrue(request.signal.aborted);
        const error = await result;
        assert.instanceOf(error, Error);
        assert.equal(error.message, "PagerDuty event timed out after 30 seconds");
        assert.equal(clock.countTimers(), 0);
      } finally {
        clock.restore();
      }
    });

    it("settles at the deadline even when the SDK ignores abort during a retry sleep", async function () {
      const clock = sinon.useFakeTimers();
      try {
        let rejectSdk;
        eventStub.returns(new Promise((_, reject) => (rejectSdk = reject)));
        let settled = false;
        const result = sendPagerDutyEvent("route", { level: "error", at: "Bot", message: "Failure" }).catch((error) => {
          settled = true;
          return error;
        });
        await clock.tickAsync(29999);
        assert.isFalse(settled);
        await clock.tickAsync(1);
        assert.isTrue(settled);
        assert.equal((await result).message, "PagerDuty event timed out after 30 seconds");
        assert.isTrue(eventStub.firstCall.args[0].signal.aborted);
        assert.equal(clock.countTimers(), 0);
        // A late SDK rejection is still observed by Promise.race, never an unhandled rejection.
        rejectSdk(new Error("SDK retry woke after abort"));
        await clock.tickAsync(0);
      } finally {
        clock.restore();
      }
    });

    it("clears the abort timer after a successful request", async function () {
      const clock = sinon.useFakeTimers();
      try {
        await sendPagerDutyEvent("route", { level: "error", at: "Bot", message: "Failure" });
        const { signal } = eventStub.firstCall.args[0];
        assert.equal(clock.countTimers(), 0);
        await clock.tickAsync(30000);
        assert.isFalse(signal.aborted);
      } finally {
        clock.restore();
      }
    });

    it("reports HTTP failures instead of claiming recovery was accepted", async function () {
      eventStub.resolves({ ok: false, status: 429 });
      let error;
      try {
        await sendPagerDutyEvent("route", { pagerDutyEventAction: "resolve", pagerDutyDedupKey: "bot:failure" });
      } catch (caught) {
        error = caught;
      }
      assert.instanceOf(error, Error);
      assert.include(error.message, "429");
    });
  });
});
