const Web3 = require("web3");
const assert = require("assert");
const Events = require("events");

const { toBN, BN } = Web3.utils;
const Strategy = require("../src/liquidationStrategy");

const events = new Events();
describe("LiquidatorStrategy", () => {
  it("should init", () => {
    // Default config without WDF activated:
    const config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });
    assert(strat);

    // Activating WDF:
    strat = Strategy(
      {
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
  it("hasWithdrawRequestPending", () => {
    const config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });

    // Withdraw pending
    let result = strat.utils.hasWithdrawRequestPending({
      position: { withdrawalRequestPassTimestamp: 11 },
      currentBlockTime: 10
    });
    assert(result);
    // No withdraw pending
    result = strat.utils.hasWithdrawRequestPending({
      position: { withdrawalRequestPassTimestamp: 0 },
      currentBlockTime: 10
    });
    assert(!result);
    // Withdraw expired
    result = strat.utils.hasWithdrawRequestPending({
      position: { withdrawalRequestPassTimestamp: 9 },
      currentBlockTime: 10
    });
    assert(!result);
  });
  it("passedDefenseActivationPercent", () => {
    let config = {
      minSponsorSize: 10,
      defenseActivationPercent: 80,
      withdrawLiveness: 100
    };
    let strat = Strategy(config, { toBN, BN });

    // Withdrawal request expires at 1000, liveness = 100,
    // current block = 900, defense activation = 0%
    // ==> FALSE
    let result = strat.utils.passedDefenseActivationPercent({
      position: { withdrawalRequestPassTimestamp: 1000 },
      currentBlockTime: 900
    });
    assert(!result);
    // current block = 950, defense activation = 50%
    // ==> FALSE
    result = strat.utils.passedDefenseActivationPercent({
      position: { withdrawalRequestPassTimestamp: 1000 },
      currentBlockTime: 950
    });
    assert(!result);
    // current block = 980, defense activation = 80%
    // ==> TRUE
    result = strat.utils.passedDefenseActivationPercent({
      position: { withdrawalRequestPassTimestamp: 1000 },
      currentBlockTime: 980
    });
    assert(result);
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
    // current blocktime=100 plus default liquidationDeadline=300
    assert.equal(result[4], 400);
  });
  it("calculateTokensToLiquidate", () => {
    const config = {
      minSponsorSize: 10,
      defenseActivationPercent: 50,
      withdrawLiveness: 1000
    };
    let strat = Strategy(config, { toBN, BN });
    let result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respect position size
    assert.equal(result.toString(), "10");

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 8,
      positionTokens: 10,
      maxTokensToLiquidateWei: "1000"
    });
    // should respect emp min sponsor size
    assert.equal(result.toString(), "0");

    strat = Strategy(
      {
        ...config,
        minSponsorSize: 900
      },
      { toBN, BN }
    );
    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 1000,
      maxTokensToLiquidateWei: "1000"
    });
    // should respect our balance
    assert.equal(result.toString(), "100");

    strat = Strategy(
      {
        ...config,
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

    result = strat.utils.calculateTokensToLiquidate({
      syntheticTokenBalance: 100,
      positionTokens: 0,
      maxTokensToLiquidateWei: "1000"
    });
    // position has 0 tokens, no error thrown
    assert.equal(result.toString(), "0");
  });
  it("canLiquidateMinimum", () => {
    const config = {
      minSponsorSize: "10"
    };
    let strat = Strategy(config, { toBN, BN });
    // Balance > minimum && (position.numTokens - minimum >= minimum)
    let result = strat.utils.canLiquidateMinimum({
      position: { numTokens: "20" },
      syntheticTokenBalance: "11"
    });
    assert(result);
    // Balance > minimum && !(position.numTokens - minimum >= minimum)
    result = strat.utils.canLiquidateMinimum({
      position: { numTokens: "19" },
      syntheticTokenBalance: "11"
    });
    assert(!result);
    // Balance < minimum
    result = strat.utils.canLiquidateMinimum({
      position: { numTokens: "20" },
      syntheticTokenBalance: "9"
    });
    assert(!result);
  });
  it("canLiquidateFully", () => {
    const config = {
      minSponsorSize: "10"
    };
    let strat = Strategy(config, { toBN, BN });
    // Balance >= position size
    let result = strat.utils.canLiquidateFully({
      position: { numTokens: "20" },
      syntheticTokenBalance: "20"
    });
    assert(result);
    result = strat.utils.canLiquidateFully({
      position: { numTokens: "19" },
      syntheticTokenBalance: "20"
    });
    assert(result);
    // Balance < position size
    result = strat.utils.canLiquidateFully({
      position: { numTokens: "21" },
      syntheticTokenBalance: "20"
    });
    assert(!result);
  });
  it("processPosition", () => {
    let config = {
      minSponsorSize: 10
    };
    let strat = Strategy(config, { toBN, BN });
    let position = {
      numTokens: "10000",
      sponsor: "0x1234"
    };
    let positionWithPendingWithdrawal = {
      ...position,
      withdrawalRequestPassTimestamp: 1000
    };
    let result;

    // Cases where WDF is not active:
    // - Always liquidate using fully balance
    result = strat.processPosition({
      position,
      syntheticTokenBalance: "100",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert.equal(result[3].rawValue, "100");
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: "100",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert.equal(result[3].rawValue, "100");

    // Cases where WDF is active:
    config = {
      defenseActivationPercent: 50,
      withdrawLiveness: 1000,
      minSponsorSize: 10
    };
    strat = Strategy(config, { toBN, BN }, (...args) => events.emit("log", ...args));
    // - No pending withdrawal
    //    - Liquidate using full balance
    result = strat.processPosition({
      position,
      syntheticTokenBalance: "100",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert.equal(result[3].rawValue, "100");
    // - Pending withdrawal:
    //    - Can liquidate full position
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: "10000",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert.equal(result[3].rawValue, position.numTokens);
    //    - Cannot liquidate full position, not passed WDF activation %
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: "1000",
      currentBlockTime: 400,
      maxCollateralPerToken: "0"
    });
    assert(!result);
    //    - Cannot liquidate full position, passed WDF activation %
    //      Note: This should log a WDF alert
    const eventlist = [];
    events.on("log", (severity, data) => {
      // listen for WDF alert logs
      assert(data.message.includes("extending withdraw deadline"));
      eventlist.push({ severity, data });
    });
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: "1000",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert.equal(eventlist.length, 1);
    assert.equal(result[3].rawValue, config.minSponsorSize);
    events.removeAllListeners("log");
    //    - Cannot liquidate full position, passed WDF activation %, can't liquidate min
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: "9",
      currentBlockTime: 500,
      maxCollateralPerToken: "0"
    });
    assert(!result);

    // Edge cases:
    // - Respects maxTokensToLiquidateWei
    result = strat.processPosition({
      position: positionWithPendingWithdrawal,
      syntheticTokenBalance: parseInt(position.numTokens),
      currentBlockTime: 500,
      empMinSponsorSize: 10,
      maxCollateralPerToken: "0",
      maxTokensToLiquidateWei: "100"
    });
    assert.equal(result[3].rawValue, "100");
  });
});
