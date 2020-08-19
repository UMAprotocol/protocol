const test = require("tape");
const utils = require("../FormattingUtils");
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
      t.equal(result, 10n ** 12n);
      result = convertDecimals(100);
      t.equal(result, 10n ** 14n);

      convertDecimals = utils.ConvertDecimals(18, 6);
      result = convertDecimals(1);
      t.equal(result, 0n);
      result = convertDecimals(10n ** 18n);
      t.equal(result, 10n ** 6n);

      convertDecimals = utils.ConvertDecimals(0, 6);
      result = convertDecimals(1);
      t.equal(result, 10n ** 6n);
      result = convertDecimals(1000);
      t.equal(result, 10n ** 9n);
      t.end();
    });
    // Just testing that bignumber can wrap bigint
    t.test("BigInt to BigNumber", t => {
      const result = 10000000000000n;
      const bn = BigNumber(result);
      t.equal(bn.toString(), result.toString());
      t.end();
    });
  });
});
