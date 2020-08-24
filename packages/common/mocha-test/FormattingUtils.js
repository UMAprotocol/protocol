const utils = require("../src/FormattingUtils");
const assert = require("assert");

describe("FormattingUtils", () => {
  describe("ConvertDecimals", () => {
    it("init", () => {
      const result = utils.ConvertDecimals(6, 18);
      assert(result);
    });
    it("conversions", () => {
      let convertDecimals = utils.ConvertDecimals(6, 18);
      let result = convertDecimals(1);
      assert.equal(result.toString(), (10n ** 12n).toString());
      result = convertDecimals(100);
      assert.equal(result.toString(), (10n ** 14n).toString());

      convertDecimals = utils.ConvertDecimals(18, 6);
      result = convertDecimals(1);
      assert.equal(result.toString(), "0");
      result = convertDecimals((10n ** 18n).toString());
      assert.equal(result.toString(), (10n ** 6n).toString());

      result = convertDecimals(0);
      assert.equal(result.toString(), "0");

      convertDecimals = utils.ConvertDecimals(0, 6);
      result = convertDecimals(1);
      assert.equal(result.toString(), (10n ** 6n).toString());
      result = convertDecimals(1000);
      assert.equal(result.toString(), (10n ** 9n).toString());
    });
  });
});
