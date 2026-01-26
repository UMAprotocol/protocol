const assert = require("assert");

describe("Pino createPinoTransports", function () {
  let createPinoTransports;
  let originalEnv;

  before(function () {
    // Save original environment
    originalEnv = { ...process.env };
    // Import after saving env
    createPinoTransports = require("../../dist/pinoLogger/Transports").createPinoTransports;
  });

  afterEach(function () {
    // Restore original environment after each test
    process.env = { ...originalEnv };
  });

  describe("PAGER_DUTY_V2_CONFIG error handling", function () {
    it("Should throw error for invalid JSON syntax", function () {
      process.env.PAGER_DUTY_V2_CONFIG = '{"integrationKey": "test-key"'; // Missing closing brace

      assert.throws(() => createPinoTransports(), {
        name: "Error",
        message: /Failed to parse PAGER_DUTY_V2_CONFIG environment variable as JSON/,
      });
    });

    it("Should throw error for non-object JSON (array)", function () {
      process.env.PAGER_DUTY_V2_CONFIG = '["not", "an", "object"]';

      assert.throws(() => createPinoTransports(), {
        name: "Error",
        message: /Invalid PAGER_DUTY_V2_CONFIG object/,
      });
    });

    it("Should throw error for non-object JSON (null)", function () {
      process.env.PAGER_DUTY_V2_CONFIG = "null";

      assert.throws(() => createPinoTransports(), {
        name: "Error",
        message: /Invalid PAGER_DUTY_V2_CONFIG object/,
      });
    });

    it("Should throw error for non-object JSON (string)", function () {
      process.env.PAGER_DUTY_V2_CONFIG = '"just a string"';

      assert.throws(() => createPinoTransports(), {
        name: "Error",
        message: /Invalid PAGER_DUTY_V2_CONFIG object/,
      });
    });

    it("Should throw error for non-object JSON (number)", function () {
      process.env.PAGER_DUTY_V2_CONFIG = "42";

      assert.throws(() => createPinoTransports(), {
        name: "Error",
        message: /Invalid PAGER_DUTY_V2_CONFIG object/,
      });
    });

    it("Should create transport successfully with valid config", function () {
      process.env.PAGER_DUTY_V2_CONFIG = JSON.stringify({
        integrationKey: "test-key",
        disabled: true, // Disable to avoid needing to mock PagerDuty
      });

      assert.doesNotThrow(() => createPinoTransports());
    });
  });
});
