const { assert } = require("chai");
const { createConfig, convertLevelToSeverity } = require("../../dist/shared/PagerDutyV2Transport.js");

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

  // Note: sendPagerDutyEvent integration with actual PagerDuty API is tested indirectly
  // through Winston and Pino transport tests where the function is properly stubbed.
  // Testing the actual API call would require real API credentials and is better suited
  // for integration tests run separately from unit tests.
});
