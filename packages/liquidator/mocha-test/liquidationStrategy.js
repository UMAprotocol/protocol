const web3 = require("web3");
const assert = require("assert");
const Events = require("events");

const { toBN, BN } = web3.utils;
const Strategy = require("../src/liquidationStrategy");

const events = new Events();
describe("LiquidatorStrategy", () => {
  it("should init", () => {
    let strat = Strategy({}, { toBN, BN });

    assert(strat);
    strat = Strategy(
      {
        whaleDefenseFundWei: 1000,
        defenseActivationPercent: 50,
        withdrawalLiveness: 1000
      },
      { toBN, BN }
    );
    assert(strat);
  });
  it("withdrawProgressPercent", () => {
    let strat = Strategy({}, { toBN, BN });

    let result = strat.withdrawProgressPercent(100, 100, 101);
    assert.equal(result, 100);

    result = strat.withdrawProgressPercent(100, 100, 0);
    assert.equal(result, 0);

    result = strat.withdrawProgressPercent(100, 100, 1);
    // comparing floats
    assert.equal(result.toFixed(2), "1.00");

    result = strat.withdrawProgressPercent(1000, 1000, 1);
    assert.equal(result.toFixed(2), "0.10");

    result = strat.withdrawProgressPercent(1000, 1000, 500);
    assert.equal(result.toFixed(2), "50.00");

    result = strat.withdrawProgressPercent(1000, 2000, 1500);
    assert.equal(result.toFixed(2), "50.00");
  });
  it("createLiquidationParams", () => {
    let strat = Strategy({}, { toBN, BN });
    const params = {
      sponsor: "0x1234",
      maxCollateralPerToken: "1",
      tokensToLiquidate: "1000",
      currentBlockTime: 100
    };
    let result = strat.createLiquidationParams(params);
    assert(result.length);
    assert.equal(result[0], params.sponsor);
    assert.equal(result[1].rawValue, "0");
    assert.equal(result[2].rawValue, params.maxCollateralPerToken);
    assert.equal(result[3].rawValue, params.tokensToLiquidate);
    // curren blocktime=100 plus default liquidationDeadline=300
    assert(result[4], 400);
  });
  it("calculateTokensToLiquidate", () => {
    let strat = Strategy(
      {
        whaleDefenseFundWei: "10",
        defenseActivationPercent: 50,
        withdrawalLiveness: 1000
      },
      { toBN, BN }
    );
    let result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 10,
      empMinSponsorSize: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect position size
    assert.equal(result.toString(), "10");

    strat = Strategy(
      {
        whaleDefenseFundWei: "95",
        defenseActivationPercent: 50,
        withdrawalLiveness: 1000
      },
      { toBN, BN }
    );
    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 10,
      empMinSponsorSize: 10,
      whaleDefenseFundWei: 95,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect emp min sponsor size
    assert.equal(result.toString(), "0");

    strat = Strategy(
      {
        whaleDefenseFundWei: "60",
        defenseActivationPercent: 50,
        withdrawalLiveness: 1000
      },
      { toBN, BN }
    );

    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 50,
      empMinSponsorSize: 10,
      whaleDefenseFundWei: 60,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect wdf reserve value
    assert.equal(result.toString(), "40");

    strat = Strategy({}, { toBN, BN });

    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 8,
      positionTokens: 10,
      empMinSponsorSize: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect emp min sponsor size
    assert.equal(result.toString(), "0");

    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 1000,
      empMinSponsorSize: 900,
      maxTokensToLiquidateWei: "1000"
    });
    // should respect our balance
    assert.equal(result.toString(), "100");

    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 101,
      empMinSponsorSize: 100,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect empminsponsor size
    assert.equal(result.toString(), "1");

    result = strat.calculateTokensToLiquidate({
      syntheticTokenBalance: 1000,
      positionTokens: 10000,
      empMinSponsorSize: 100,
      maxTokensToLiquidateWei: "100"
    });
    // should respect max to liquidate
    assert.equal(result.toString(), "100");
  });
  it("shouldLiquidate", () => {
    let strat = Strategy({}, { toBN, BN });
    let result = strat.shouldLiquidate({ tokensToLiquidate: "100000", empMinSponsorSize: "10" });
    assert(result);
    result = strat.shouldLiquidate({ tokensToLiquidate: "0", empMinSponsorSize: "10" });
    assert(!result);
  });
  it("shouldLiquidateMinimum", () => {
    let strat = Strategy(
      { defenseActivationPercent: 50, withdrawalLiveness: 1000, empMinSponsorSize: "10" },
      { toBN, BN }
    );
    const position = {
      withdrawalRequestPassTimestamp: 1000,
      numTokens: "100"
    };
    let result = strat.shouldLiquidateMinimum({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: "50",
      currentBlockTime: 500
    });
    assert(result);
    result = strat.shouldLiquidateMinimum({
      position,
      empMinSponsorSize: "10",
      // our token balance is high enough to liquidate full position
      // so this should not active minimum
      syntheticTokenBalance: "100",
      currentBlockTime: 500
    });
    assert(!result);
    result = strat.shouldLiquidateMinimum({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: "50",
      // sponsor has not passed the withdraw liveness % complete to liquidate
      currentBlockTime: 0
    });
    assert(!result);
    result = strat.shouldLiquidateMinimum({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: "50",
      // withdraw has passed liveness
      currentBlockTime: 1000
    });
    assert(!result);
  });
  it("processPosition", () => {
    const config = {
      whaleDefenseFundWei: "100",
      defenseActivationPercent: 50,
      withdrawalLiveness: 1000
    };
    let strat = Strategy(config, { toBN, BN }, (...args) => events.emit(...args));
    const position = {
      withdrawalRequestPassTimestamp: 1000,
      numTokens: "10000",
      sponsor: "0x1234"
    };
    // this should activate wdf
    let result = strat.processPosition({
      position,
      syntheticTokenBalance: "1000",
      empMinSponsorSize: "10",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    // This should liquidate entire position
    assert(result[3].rawValue, config.empMinSponsorSize);
    result = strat.processPosition({
      position,
      empMinSponsorSize: "10",
      // we have enough to cover full position + wdf
      syntheticTokenBalance: parseInt(position.numTokens) + parseInt(config.whaleDefenseFundWei),
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    // should liquidate entire position
    assert(result[3].rawValue, position.numTokens);

    // This should liquidate position but maintain wdf
    assert(result[3].rawValue, config.empMinSponsorSize);
    result = strat.processPosition({
      position,
      empMinSponsorSize: "10",
      // we have enough to cover full position + wdf
      syntheticTokenBalance: parseInt(position.numTokens),
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert(result[3].rawValue, parseInt(position.numTokens) - parseInt(config.whaleDefenseFundWei));

    // This should respect maxTokensToLiquidate
    assert(result[3].rawValue, config.empMinSponsorSize);
    result = strat.processPosition({
      position,
      syntheticTokenBalance: parseInt(position.numTokens),
      currentBlockTime: 500,
      empMinSponsorSize: 10,
      maxCollateralPerToken: "0",
      maxTokensToLiquidateWei: "100"
    });
    assert(result[3].rawValue, "100");

    // This should process entire position
    assert(result[3].rawValue, config.empMinSponsorSize);
    result = strat.processPosition({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: parseInt(position.numTokens) * 10,
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert(result[3].rawValue, position.numTokens);

    // should produce a log
    let eventcount = 0;
    events.once("log", (type, data) => {
      assert.equal(type, "error");
      assert(data);
      eventcount++;
    });
    // should not produce result
    result = strat.processPosition({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: "0",
      currentBlockTime: 500,
      maxCollateralPerToken: "0",
      maxTokensToLiquidateWei: "100"
    });
    assert(!result);
    assert.equal(eventcount, 1);
  });
});
