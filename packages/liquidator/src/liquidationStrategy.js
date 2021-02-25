const assert = require("assert");
/**
 * This module is responsible for sizing liquidation positions.  If a defensive strategy is enabled, it
 * will check withdraw positions to see if they require an extension rather than full liquidation.
 * @constructor
 * @param {object} config - State configuration, env vars, contract vars
 * @property {number} config.whaleDefenseFundWei - Optional value which enables strategy if above 0. Specify the
 * reserves to hold in tokens to allow for defense strategy. 0 disables.
 * @property {number} config.defenseActivationPercent - The % past liveness a position needs to be before its
 * extended. Optional unless whaleDefenseFundWei is enabled.
 * @property {number} config.liquidationDeadline - Aborts the liquidation if the transaction is mined this amount
 * of time after this time has passed
 * @property {number} config.withdrawLiveness - Optional unless whaleDefenseFundWei is enabled. The positions
 * withdraw liveness duration, set by emp contract.
 * @property {number} config.minSponsorSize - Emp minimum sponsor position size in tokens.
 * Example:
 * {
 *   whaleDefenseFundWei: '10000000000000000000',
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
    // how much money to set aside for defense in tokens
    whaleDefenseFundWei = 0,
    // when to activate defense, when withdraw is X% in time complete
    defenseActivationPercent,
    liquidationMinPrice = "0",
    // `liquidationDeadline`: Aborts the liquidation if the transaction is mined this amount of time after the
    liquidationDeadline = 300,
    // the amount of time with which to reset the slow withdraw timer
    withdrawLiveness,
    // emp contracts min sponsor size, specified in tokens, also the minimum amount of tokens to liquidate with
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
  whaleDefenseFundWei &&
    assert(
      defenseActivationPercent >= 0 && defenseActivationPercent <= 100,
      "Requires defenseActivationPercent to bet set between 0 and 100"
    );
  whaleDefenseFundWei && assert(withdrawLiveness > 0, "requires withdrawLiveness");

  // Function which packs the arguments for a liquidation.
  // returns parameters for empContract.methods.createLiquidation
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

  // use in the case of a non whale defense liquidation
  // Similar to the logic that already exists, but takes into account more information
  function calculateTokensToLiquidate({ syntheticTokenBalance, positionTokens, maxTokensToLiquidateWei }) {
    positionTokens = toBN(positionTokens);
    syntheticTokenBalance = toBN(syntheticTokenBalance);

    if (positionTokens.lte(0)) return toBN(0);

    // available capital calculates the max we can currently spend
    let availableCapital = BN.max(toBN(0), syntheticTokenBalance.sub(toBN(whaleDefenseFundWei)));
    // let availableCapital = syntheticTokenBalance
    if (maxTokensToLiquidateWei) availableCapital = BN.min(toBN(maxTokensToLiquidateWei), availableCapital);

    // we have enough capital to fully liquidate positon
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
  // SyntheticTokenBalance should be passed in respecting maxTokensToLiquidate
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

    // whale fund enabled
    if (whaleDefenseFundWei && toBN(whaleDefenseFundWei).gt(toBN("0"))) {
      // we should only liquidate the minimum here to extend withdraw
      if (
        shouldLiquidateMinimum({
          position,
          syntheticTokenBalance,
          currentBlockTime
        })
      ) {
        // we are using the WDF to liquidate. We need to alert user
        emit("info", {
          message:
            "Liquidator bot is extending withdraw deadline, funds may need to be added to liquidate full position",
          position: position,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          syntheticTokenBalance: syntheticTokenBalance.toString(),
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
          whaleDefenseFundWei: whaleDefenseFundWei.toString(),
          currentBlockTime,
          ...logInfo
        });
        // this assume empMinSponsorSize will always be <= maxTokensToLiquidate
        return createLiquidationParams({
          sponsor: position.sponsor,
          // Only liquidating the minimum size to extend withdraw
          tokensToLiquidate: minSponsorSize,
          currentBlockTime,
          maxCollateralPerToken
        });
      }
    }

    // calculate tokens to liquidate respecting all constraints
    const tokensToLiquidate = calculateTokensToLiquidate({
      syntheticTokenBalance,
      positionTokens: position.numTokens,
      maxTokensToLiquidateWei
    });

    // check if we should try to liquidate this position
    if (shouldLiquidate({ tokensToLiquidate })) {
      // We should liquidate the entire position using our capital - wdf
      return createLiquidationParams({
        sponsor: position.sponsor,
        tokensToLiquidate,
        currentBlockTime,
        maxCollateralPerToken
      });
    }
    // we dont liquidate, dont return anything. Probably because amount to liquidate is 0
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

  // Returns true if enough of the withdrawal liveness has passed that the WDF strategy can be activated.
  function passedDefenseActivationPercent({ position, currentBlockTime }) {
    return (
      // this position has a withdraw pending
      Number(position.withdrawalRequestPassTimestamp) != 0 &&
      // withdraw has not passed liveness
      Number(position.withdrawalRequestPassTimestamp) > currentBlockTime &&
      withdrawProgressPercent(withdrawLiveness, position.withdrawalRequestPassTimestamp, currentBlockTime) >=
        parseFloat(defenseActivationPercent)
    );
  }

  // Should we try to delay this withdrawal. Update this logic to change conditions to run delay strategy.
  function shouldLiquidateMinimum({ position, syntheticTokenBalance, currentBlockTime }) {
    assert(defenseActivationPercent >= 0, "requires defenseActivationPercent");
    assert(withdrawLiveness > 0, "requires withdrawLiveness");
    syntheticTokenBalance = toBN(syntheticTokenBalance);
    const empMinSponsorSize = toBN(minSponsorSize);
    currentBlockTime = Number(currentBlockTime);

    // our synthetic balance is less than the amount required to extend deadline
    if (syntheticTokenBalance.lt(empMinSponsorSize)) return false;
    // we have enough to fully liquidate position respecting WDF, so do not do the minimum
    if (syntheticTokenBalance.sub(toBN(whaleDefenseFundWei)).gte(toBN(position.numTokens))) return false;
    // position cant go below the minimum emp sponsor size
    if (
      toBN(position.numTokens)
        .sub(empMinSponsorSize)
        .lt(empMinSponsorSize)
    )
      return false;
    // all conditions passed and we should minimally liquidate to extend timer as long as the
    // liveness timer on withdraw has passed the activation threshold.
    return passedDefenseActivationPercent({ position, currentBlockTime });
  }

  // Any new constraints can be added here, but for now
  // only dont liquidate if the amount to liquidate is <=0
  function shouldLiquidate({ tokensToLiquidate }) {
    tokensToLiquidate = toBN(tokensToLiquidate);
    // nothing to liquidate
    if (tokensToLiquidate.lte(toBN(0))) return false;
    // any other conditions we do try to liquidate
    return true;
  }

  return {
    // Main function
    processPosition,
    // Utility calls exposed for testing or other use
    // Not really needed outside this module
    utils: {
      shouldLiquidate,
      shouldLiquidateMinimum,
      createLiquidationParams,
      passedDefenseActivationPercent,
      withdrawProgressPercent,
      calculateTokensToLiquidate
    }
  };
};
