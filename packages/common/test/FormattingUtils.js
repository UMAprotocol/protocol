const test = require("tape");
const utils = require("../src/FormattingUtils");
const BigNumber = require("bignumber.js");

// Please recommend a better place/way to do this. Technically this
// does not depend on web3 or truffle, but can include that for consistency.
test("FormattingUtils", t => {
  t.test("ConvertDecimals", t => {
    t.test("init", t => {
      const result = utils.ConvertDecimals(6, 18);
      t.ok(result);
      t.end();
    });
    t.test("conversions", t => {
      let convertDecimals = utils.ConvertDecimals(6, 18);
      let result = convertDecimals(1);
      t.equal(result.toString(), (10n ** 12n).toString());
      result = convertDecimals(100);
      t.equal(result.toString(), (10n ** 14n).toString());

      convertDecimals = utils.ConvertDecimals(18, 6);
      result = convertDecimals(1);
      t.equal(result.toString(), "0");
      result = convertDecimals(10n ** 18n);
      t.equal(result.toString(), (10n ** 6n).toString());

      result = convertDecimals(0);
      t.equal(result.toString(), "0");

      convertDecimals = utils.ConvertDecimals(0, 6);
      result = convertDecimals(1);
      t.equal(result.toString(), (10n ** 6n).toString());
      result = convertDecimals(1000);
      t.equal(result.toString(), (10n ** 9n).toString());
      t.end();
    });
  });
});
