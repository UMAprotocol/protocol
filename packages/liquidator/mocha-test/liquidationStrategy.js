const Web3 = require("web3");
const assert = require("assert");
const Events = require("events");

const { toBN, BN } = Web3.utils;
const Strategy = require("../src/liquidationStrategy");

const events = new Events();
describe("LiquidatorStrategy", () => {
  it("should init", () => {
    const config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });

    assert(strat);
    strat = Strategy(
      {
        whaleDefenseFundWei: 1000,
        defenseActivationPercent: 50,
        withdrawLiveness: 1000,
        minSponsorSize: 10
      },
      { toBN, BN }
    );
    assert(strat);
  });
  it("withdrawProgressPercent", () => {
    const config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });

    let result = strat.utils.withdrawProgressPercent(100, 100, 101);
    assert.equal(result, 100);

    result = strat.utils.withdrawProgressPercent(100, 100, 0);
    assert.equal(result, 0);

    result = strat.utils.withdrawProgressPercent(100, 100, 1);
    // comparing floats
    assert.equal(result.toFixed(2), "1.00");

    result = strat.utils.withdrawProgressPercent(1000, 1000, 1);
    assert.equal(result.toFixed(2), "0.10");

    result = strat.utils.withdrawProgressPercent(1000, 1000, 500);
    assert.equal(result.toFixed(2), "50.00");

    result = strat.utils.withdrawProgressPercent(1000, 2000, 1500);
    assert.equal(result.toFixed(2), "50.00");
  });
  it("createLiquidationParams", () => {
    const config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });
    const params = {
      sponsor: "0x1234",
      maxCollateralPerToken: "1",
      tokensToLiquidate: "1000",
      currentBlockTime: 100
    };
    let result = strat.utils.createLiquidationParams(params);
    assert(result.length);
    assert.equal(result[0], params.sponsor);
    assert.equal(result[1].rawValue, "0");
    assert.equal(result[2].rawValue, params.maxCollateralPerToken);
    assert.equal(result[3].rawValue, params.tokensToLiquidate);
    // curren blocktime=100 plus default liquidationDeadline=300
    assert(result[4], 400);
  });
  it("calculateTokensToLiquidate", () => {
    const config = {
      minSponsorSize: 10,
      whaleDefenseFundWei: "10",
      defenseActivationPercent: 50,
      withdrawLiveness: 1000
    };
    let strat = Strategy(config, { toBN, BN });
    let result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect position size
    assert.equal(result.toString(), "10");

    strat = Strategy(
      {
        ...config,
        whaleDefenseFundWei: "95"
      },
      { toBN, BN }
    );
    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 10,
      whaleDefenseFundWei: 95,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect emp min sponsor size
    assert.equal(result.toString(), "0");

    strat = Strategy(
      {
        ...config,
        whaleDefenseFundWei: "60"
      },
      { toBN, BN }
    );

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 50,
      whaleDefenseFundWei: 60,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect wdf reserve value
    assert.equal(result.toString(), "40");

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 8,
      positionTokens: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect emp min sponsor size
    assert.equal(result.toString(), "0");

    strat = Strategy(
      {
        ...config,
        whaleDefenseFundWei: "95",
        minSponsorSize: 900
      },
      { toBN, BN }
    );

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 1000,
      maxTokensToLiquidateWei: "1000"
    });
    // should respect our balance and whale defense fund
    assert.equal(result.toString(), "5");

    strat = Strategy(
      {
        ...config,
        whaleDefenseFundWei: "95",
        minSponsorSize: 100
      },
      { toBN, BN }
    );

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 101,
      maxTokensToLiquidateWei: "1000"
    });
    // should respsect empminsponsor size
    assert.equal(result.toString(), "1");

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 1000,
      positionTokens: 10000,
      maxTokensToLiquidateWei: "100"
    });
    // should respect max to liquidate
    assert.equal(result.toString(), "100");
  });
  it("shouldLiquidate", () => {
    const config = {
      minSponsorSize: "10"
    };
    let strat = Strategy(config, { toBN, BN });
    let result = strat.utils.shouldLiquidate({ tokensToLiquidate: "100000" });
    assert(result);
    result = strat.utils.shouldLiquidate({ tokensToLiquidate: "0" });
    assert(!result);
  });
  it("shouldLiquidateMinimum", () => {
    const config = {
      defenseActivationPercent: 50,
      minSponsorSize: "10",
      withdrawLiveness: 1000
    };
    let strat = Strategy(config, { toBN, BN });
    const position = {
      withdrawalRequestPassTimestamp: 1000,
      numTokens: "100"
    };
    let result = strat.utils.shouldLiquidateMinimum({
      position,
      syntheticTokenBalance: "50",
      currentBlockTime: 500
    });
    assert(result);
    result = strat.utils.shouldLiquidateMinimum({
      position,
      // our token balance is high enough to liquidate full position
      // so this should not active minimum
      syntheticTokenBalance: "100",
      currentBlockTime: 500
    });
    assert(!result);
    result = strat.utils.shouldLiquidateMinimum({
      position,
      syntheticTokenBalance: "50",
      // sponsor has not passed the withdraw liveness % complete to liquidate
      currentBlockTime: 0
    });
    assert(!result);
    result = strat.utils.shouldLiquidateMinimum({
      position,
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
      withdrawLiveness: 1000,
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN }, (...args) => events.emit("log", ...args));
    const position = {
      withdrawalRequestPassTimestamp: 1000,
      numTokens: "10000",
      sponsor: "0x1234"
    };
    // listen for logs
    const eventlist = [];
    events.on("log", (severity, data) => {
      assert(data.message.includes("extending withdraw deadline"));
      eventlist.push({ severity, data });
    });
    // this should activate wdf
    let result = strat.processPosition({
      position,
      syntheticTokenBalance: "1000",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    // expect 1 log notifying user of wdf
    assert.equal(eventlist.length, 1);
    // This should liquidate entire position
    assert(result[3].rawValue, config.minSponsorSize);
    events.removeAllListeners("log");

    result = strat.processPosition({
      position,
      // we have enough to cover full position + wdf
      syntheticTokenBalance: parseInt(position.numTokens) + parseInt(config.whaleDefenseFundWei),
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    // should liquidate entire position
    assert(result[3].rawValue, position.numTokens);

    // This should liquidate position but maintain wdf
    assert(result[3].rawValue, config.minSponsorSize);
    result = strat.processPosition({
      position,
      // we have enough to cover full position + wdf
      syntheticTokenBalance: parseInt(position.numTokens),
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert(result[3].rawValue, parseInt(position.numTokens) - parseInt(config.whaleDefenseFundWei));

    // This should respect maxTokensToLiquidate
    assert(result[3].rawValue, config.minSponsorSize);
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
    assert(result[3].rawValue, config.minSponsorSize);
    result = strat.processPosition({
      position,
      empMinSponsorSize: "10",
      syntheticTokenBalance: parseInt(position.numTokens) * 10,
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert(result[3].rawValue, position.numTokens);

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
  });
});
