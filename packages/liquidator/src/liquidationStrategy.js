const assert = require("assert");
/**
 * This module is responsible for sizing liquidation positions.  If a defensive strategy is enabled, it
 * will check withdraw positions to see if they require an extension rather than full liquidation.
 * @constructor
 * @param {object} config - State configuration, env vars, contract vars
 * @property {number} config.defenseActivationPercent - The % past liveness a position needs to be before its
 * extended. This activates the Whale Defense strategy if it is > 0.
 * @property {number} config.liquidationDeadline - Aborts the liquidation if the transaction is mined this amount
 * of time after this time has passed
 * @property {number} config.withdrawLiveness - Optional unless defenseActivationPercent is enabled. The positions
 * withdraw liveness duration, set by financialContract contract.
 * @property {number} config.minSponsorSize - financialContract minimum sponsor position size in tokens.
 * Example:
 * {
 *   defenseActivationPercent: 80,
 *   liquidationDeadline: 300,
 *   withdrawLiveness: 10000,
 *   minSponsorSize: '5000000000000000000'
 * }
 * @param {object} deps - Library dependencies
 * @property {object} deps.toBN - toBN function
 * @property {object} deps.BN - BN utilities
 * Example:
 * {
 *   toBN: Web3.utils.toBN,
 *   BN: Web3.utils.BN,
 * }
 * @callback emit - A way to emit logs to an external logger
 * @param {string} severity - Log level severity
 * @param {object} data - Any data you want to be sent in log
 * Example:
 * function log(severity,data){
 *   logger[severity]({ at:'Liquidator', ...data })
 * }
 */
module.exports = (
  {
    // when to activate defense, when withdraw is X% in time complete
    defenseActivationPercent = 0,
    liquidationMinPrice = "0",
    // `liquidationDeadline`: Aborts the liquidation if the transaction is mined this amount of time after the
    liquidationDeadline = 300,
    // the amount of time with which to reset the slow withdraw timer
    withdrawLiveness,
    // financialContract contracts min sponsor size, specified in tokens, also the minimum amount of tokens to liquidate with
    // resetting timer
    minSponsorSize
  } = {},
  // These could probably be pulled in from web3, but the pattern is here to add
  // Any additional library dependencies if needed
  { toBN, BN } = {},
  // Experimental emit function to allow the module to push data out to parent. In
  // this case its only logs in the form of emit(logSeverity,logData)
  // A default function is added so that passing in the logging function is optional.
  emit = x => x
) => {
  assert(liquidationDeadline >= 0, "liquidationDeadline must be 0 or higher");
  assert(minSponsorSize, "requires minSponsorSize");
  assert(toBN, "requires toBN");
  assert(BN, "requires BN");

  // these variables are optional and are only checked if WDF is activated
  const wdfActive = typeof defenseActivationPercent === "number" && defenseActivationPercent > 0;
  if (wdfActive) {
    assert(defenseActivationPercent <= 100, "Requires defenseActivationPercent to bet set between (0, 100]");
    assert(withdrawLiveness > 0, "requires withdrawLiveness");
  }

  // Function which packs the arguments for a liquidation.
  // returns parameters for financialContract.methods.createLiquidation
  function createLiquidationParams({ sponsor, tokensToLiquidate, currentBlockTime, maxCollateralPerToken }) {
    assert(sponsor, "requires sponsor to liquidate");
    assert(tokensToLiquidate, "requires tokenToLiquidate");
    assert(currentBlockTime >= 0, "requires currentBlockTime");
    assert(maxCollateralPerToken, "requires maxCollateralPerToken");
    return [
      sponsor,
      { rawValue: liquidationMinPrice.toString() },
      { rawValue: maxCollateralPerToken.toString() },
      { rawValue: tokensToLiquidate.toString() },
      parseInt(currentBlockTime) + liquidationDeadline
    ];
  }

  // Return how many tokens that the bot can liquidate, taking into account
  // the bot's balance and the minimum position size.
  function calculateTokensToLiquidate({ syntheticTokenBalance, positionTokens, maxTokensToLiquidateWei }) {
    positionTokens = toBN(positionTokens);
    syntheticTokenBalance = toBN(syntheticTokenBalance);

    if (positionTokens.lte(0)) return toBN(0);

    // Available capital calculates the max we can currently spend.
    // If there is NO withdrawal request pending (or the request has expired liveness), then
    // we'll ignore the WDF constraint and just liquidate with max funds.
    let availableCapital = syntheticTokenBalance;
    if (maxTokensToLiquidateWei) {
      availableCapital = BN.min(toBN(maxTokensToLiquidateWei), availableCapital);
    }

    // we have enough capital to fully liquidate position
    if (availableCapital.gte(positionTokens)) {
      return positionTokens;
    }

    // we dont have enough capital for full liquidation.
    // we check to make sure position remains above min sponsor size
    if (positionTokens.sub(availableCapital).gte(toBN(minSponsorSize))) {
      return availableCapital;
    }

    // our liquidation would bring it below min sponsor size, so just bring it to min
    return BN.max(toBN("0"), positionTokens.sub(toBN(minSponsorSize)));
  }

  // Call this with only undercollateralized position
  // SyntheticTokenBalance should be passed in respecting maxTokensToLiquidate.
  // Responsible for emitting customized logs since its already parsing
  // whether a liquidation is valid to send and for how many tokens.
  function processPosition({
    position,
    syntheticTokenBalance,
    currentBlockTime,
    maxCollateralPerToken,
    // mandated token to liquidate amount, an override
    maxTokensToLiquidateWei,
    ...logInfo
  }) {
    assert(syntheticTokenBalance, "requires syntheticTokenBalance");
    assert(currentBlockTime >= 0, "requires currentBlockTime");
    assert(position, "requires position");

    let tokensToLiquidate = toBN(0);

    if (!wdfActive || !hasWithdrawRequestPending({ position, currentBlockTime })) {
      // 1) If either WDF is not activated or there is no withdraw pending, then
      //    submit liquidation using all capital
      //     - This will include withdraws that have expired already.
      tokensToLiquidate = calculateTokensToLiquidate({
        syntheticTokenBalance,
        positionTokens: position.numTokens,
        maxTokensToLiquidateWei
      });
    } else if (canLiquidateFully({ position, syntheticTokenBalance })) {
      // 2) If you can fully liquidate, do it, regardless of whether WDF is activated.
      tokensToLiquidate = calculateTokensToLiquidate({
        syntheticTokenBalance,
        positionTokens: position.numTokens,
        maxTokensToLiquidateWei
      });
    } else if (
      wdfActive &&
      hasWithdrawRequestPending({ position, currentBlockTime }) &&
      passedDefenseActivationPercent({ position, currentBlockTime }) &&
      canLiquidateMinimum({ position, syntheticTokenBalance })
    ) {
      // 3) If WDF is active and withdraw has passed WDF activation percentage, then submit min liquidation
      emit("info", {
        message: "Liquidator bot is extending withdraw deadline, funds may need to be added to liquidate full position",
        position,
        maxLiquidationPrice: maxCollateralPerToken.toString(),
        syntheticTokenBalance: syntheticTokenBalance.toString(),
        maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
        currentBlockTime,
        ...logInfo
      });
      tokensToLiquidate = minSponsorSize;
    }

    // If tokensToLiquidate is 0 at this point, determine why and send a customized log,
    // and return undefined.
    if (toBN(tokensToLiquidate).lte(toBN(0))) {
      // Case 1: WDF is active but liveness threshold has not passed yet
      if (
        wdfActive &&
        hasWithdrawRequestPending({ position, currentBlockTime }) &&
        !passedDefenseActivationPercent({ position, currentBlockTime })
      ) {
        emit("debug", {
          message: "Liquidator bot skipping liquidation, withdrawal liveness has not passed WDF activation threshold😴",
          position,
          currentBlockTime,
          withdrawLiveness,
          defenseActivationPercent,
          ...logInfo
        });
      }
      // Case 2: Liquidator doesn't have enough balance to liquidate the minimum sponsor size
      else if (!canLiquidateMinimum({ position, syntheticTokenBalance })) {
        emit("error", {
          message: "Insufficient balance to liquidate the minimum sponsor size✋",
          position,
          syntheticTokenBalance: syntheticTokenBalance.toString(),
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
          currentBlockTime,
          ...logInfo
        });
      }
      // Case 3: Unknown
      else {
        emit("error", {
          message: "Unknown reason why liquidation is being skipped, should investigate🙃",
          position,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          syntheticTokenBalance: syntheticTokenBalance.toString(),
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
          currentBlockTime,
          ...logInfo
        });
      }
    } else {
      return createLiquidationParams({
        sponsor: position.sponsor,
        tokensToLiquidate,
        currentBlockTime,
        maxCollateralPerToken
      });
    }
  }

  // Pure function which just calculates how far a timer has progressed between 0 and 100
  // duration - total duration of the liveness in seconds
  // end - end time that withdraw passes in unix seconds ts
  // now - current block time in unix seconds ts
  function withdrawProgressPercent(duration, end, now) {
    const start = end - duration;
    const elapsed = now - start;
    if (elapsed <= 0) return 0;
    if (elapsed >= duration) return 100;
    return 100 * (elapsed / duration);
  }

  // Returns true if withdrawal request is pending and non-expired
  function hasWithdrawRequestPending({ position, currentBlockTime }) {
    return (
      // this position has a withdraw pending
      Number(position.withdrawalRequestPassTimestamp) != 0 &&
      // withdraw has not passed liveness
      Number(position.withdrawalRequestPassTimestamp) > currentBlockTime
    );
  }
  // Returns true if enough of the withdrawal liveness has passed that the WDF strategy can be activated.
  function passedDefenseActivationPercent({ position, currentBlockTime }) {
    return (
      withdrawProgressPercent(withdrawLiveness, position.withdrawalRequestPassTimestamp, currentBlockTime) >=
      parseFloat(defenseActivationPercent)
    );
  }

  // Returns true of syntheticTokenBalance >= position.tokensOutstanding
  function canLiquidateFully({ position, syntheticTokenBalance }) {
    return toBN(syntheticTokenBalance).gte(toBN(position.numTokens));
  }

  // Returns true of syntheticTokenBalance >= minSponsorSize and
  // position.tokensOutstanding - minSponsorSize >= minSponsorSize
  function canLiquidateMinimum({ position, syntheticTokenBalance }) {
    syntheticTokenBalance = toBN(syntheticTokenBalance);
    const financialContractMinSponsorSize = toBN(minSponsorSize);

    // our synthetic balance is less than the amount required to extend deadline
    if (syntheticTokenBalance.lt(financialContractMinSponsorSize)) return false;
    // position cant go below the minimum emp sponsor size
    if (
      toBN(position.numTokens)
        .sub(financialContractMinSponsorSize)
        .lt(financialContractMinSponsorSize)
    )
      return false;
    // all conditions passed and we should minimally liquidate to extend timer as long as the
    // liveness timer on withdraw has passed the activation threshold.
    return true;
  }

  return {
    // Main function
    processPosition,
    // Utility calls exposed for testing or other use
    // Not really needed outside this module
    utils: {
      canLiquidateFully,
      canLiquidateMinimum,
      createLiquidationParams,
      hasWithdrawRequestPending,
      passedDefenseActivationPercent,
      withdrawProgressPercent,
      calculateTokensToLiquidate
    }
  };
};
