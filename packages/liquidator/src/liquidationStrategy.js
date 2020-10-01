const assert = require("assert");
module.exports = (config, libs, emit = x => x) => {
  const {
    // how much money to set aside for defense in tokens
    whaleDefenseFundWei = 0,
    // when to activate defense, when withdraw is X% in time complete
    defenseActivationPercent,
    liquidationMinPrice = "0",
    // `liquidationDeadline`: Aborts the liquidation if the transaction is mined this amount of time after the
    liquidationDeadline = 300,
    // the minimum amount of tokens to liquidate with resetting timer
    withdrawalLiveness
  } = config;

  const { toBN, BN } = libs;

  assert(liquidationDeadline >= 0, "liquidationDeadline must be 0 or higher");
  assert(toBN, "requires toBN");
  assert(BN, "requires BN limit");

  // these are only needed if WDF is activated
  whaleDefenseFundWei &&
    assert(defenseActivationPercent >= 0, "Requires defenseActivationPercent to bet set between 0 and 100");
  whaleDefenseFundWei && assert(withdrawalLiveness, "requires withdrawalLiveness");

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

  function min(a, b) {
    return toBN(a).lte(toBN(b)) ? a : b;
  }
  function max(a, b) {
    return toBN(a).gte(toBN(b)) ? a : b;
  }

  // use in the case of a non whale defense liquidation
  // Similar to the logic that already exists, but takes into account more information
  function calculateTokensToLiquidate({
    syntheticTokenBalance,
    positionTokens,
    empMinSponsorSize,
    maxTokensToLiquidateWei
  }) {
    positionTokens = toBN(positionTokens);
    empMinSponsorSize = toBN(empMinSponsorSize);
    syntheticTokenBalance = toBN(syntheticTokenBalance);

    if (positionTokens.lte(0)) return toBN(0);

    // available capital calculates the max we can currently spend
    let availableCapital = syntheticTokenBalance.sub(toBN(whaleDefenseFundWei));
    if (maxTokensToLiquidateWei) availableCapital = min(toBN(maxTokensToLiquidateWei), availableCapital);

    // we have enough capital to fully liquidate positon
    if (availableCapital.gte(positionTokens)) {
      return positionTokens;
    }

    // we dont have enough capital for full liquidation.
    // we check to make sure position remains above min sponsor size
    if (positionTokens.sub(availableCapital).gt(empMinSponsorSize)) {
      return availableCapital;
    }

    // our liquidation would bring it below min sponsor size, so just bring it to min
    return max("0", positionTokens.sub(empMinSponsorSize));
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
    empMinSponsorSize,
    ...logInfo
  }) {
    assert(empMinSponsorSize, "requires empMinSponsorSize");
    assert(syntheticTokenBalance, "requires syntheticTokenBalance");
    assert(currentBlockTime >= 0, "requires currentBlockTime");
    assert(position, "requires position");

    empMinSponsorSize = toBN(empMinSponsorSize);

    // whale fund enabled
    if (whaleDefenseFundWei && toBN(whaleDefenseFundWei).gt(toBN("0"))) {
      // we should only liquidate the minimum here to extend withdraw
      if (
        shouldLiquidateMinimum({
          position,
          syntheticTokenBalance,
          empMinSponsorSize,
          currentBlockTime
        })
      ) {
        // this assume empMinSponsorSize will always be <= maxTokensToLiquidate
        return createLiquidationParams({
          sponsor: position.sponsor,
          // Only liquidating the minimum size to extend withdraw
          tokensToLiquidate: empMinSponsorSize,
          currentBlockTime,
          maxCollateralPerToken
        });
      }
    }

    // calculate tokens to liquidate respecting all constraints
    const tokensToLiquidate = calculateTokensToLiquidate({
      syntheticTokenBalance,
      positionTokens: position.numTokens,
      empMinSponsorSize,
      maxTokensToLiquidateWei
    });

    // check if we should try to liquidate this position
    if (shouldLiquidate({ tokensToLiquidate })) {
      // currently the system emits an error if we are doing a partial liquidation
      if (toBN(tokensToLiquidate).lt(toBN(position.numTokens))) {
        emit("log", "error", {
          message: "Submitting a partial liquidation: not enough synthetic to initiate full liquidation⚠️",
          sponsor: position.sponsor,
          position: position,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          tokensToLiquidate: tokensToLiquidate.toString(),
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
          ...logInfo
        });
      }
      // We should liquidate the entire position using our capital - wdf
      return createLiquidationParams({
        sponsor: position.sponsor,
        tokensToLiquidate,
        currentBlockTime,
        maxCollateralPerToken
      });
    }
    // console.log('emitting',{
    //   message: "Liquidation strategy decided not to liquidate an undercollateralized position",
    //   sponsor: position.sponsor,
    //   position: position,
    //   maxLiquidationPrice: maxCollateralPerToken.toString(),
    //   tokensToLiquidate: tokensToLiquidate.toString(),
    //   maxTokensToLiquidate: maxTokensToLiquidate.toString(),
    //   syntheticTokenBalance: syntheticTokenBalance.toString(),
    //   ...logInfo,
    // })
    // we dont liquidate, dont return anything. Probably because amount to liquidate is 0
    // emit a log
    emit("log", "error", {
      message: "Liquidation strategy decided not to liquidate an undercollateralized position",
      sponsor: position.sponsor,
      position: position,
      maxLiquidationPrice: maxCollateralPerToken.toString(),
      tokensToLiquidate: tokensToLiquidate.toString(),
      syntheticTokenBalance: syntheticTokenBalance.toString(),
      maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
      ...logInfo
    });
  }

  // Pure function which just calculates how far a timer has progressed between 0 and 100
  // duration - total duration of the liveness in seconds
  // end - end time that withdraw passes in unix seconds ts
  // now - current block time in unix seconds ts
  function withdrawProgressPercent(duration, end, now) {
    const elapsed = end - now;
    if (elapsed <= 0) return 100;
    if (elapsed >= duration) return 0;
    return 100 * (1 - elapsed / duration);
  }

  // Should we try to delay this withdrawal. Update this logic to change conditions to run delay strategy.
  function shouldLiquidateMinimum({ position, syntheticTokenBalance, empMinSponsorSize, currentBlockTime }) {
    assert(defenseActivationPercent >= 0, "requires defenseActivationPercent");
    syntheticTokenBalance = toBN(syntheticTokenBalance);
    empMinSponsorSize = toBN(empMinSponsorSize);

    // this position does not have a withdraw pending
    if (position.withdrawalRequestPassTimestamp == 0) return false;
    // withdraw has passed liveness
    if (position.withdrawalRequestPassTimestamp <= currentBlockTime) return false;
    // our synthetic balance is less than the amount required to extend deadline
    if (syntheticTokenBalance.lt(empMinSponsorSize)) return false;
    // we have enough to fully liquidate position, so do not do the minimum
    if (syntheticTokenBalance.gte(toBN(position.numTokens))) return false;
    // position cant go below the minimum emp sponsor size
    if (
      toBN(position.numTokens)
        .sub(empMinSponsorSize)
        .lt(empMinSponsorSize)
    )
      return false;
    // liveness timer on withdraw has not passed time
    if (
      withdrawProgressPercent(withdrawalLiveness, position.withdrawalRequestPassTimestamp, currentBlockTime) <
      parseFloat(defenseActivationPercent)
    )
      return false;

    // all conditions passed and we should minimally liquidate to extend timer
    return true;
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
    shouldLiquidate,
    shouldLiquidateMinimum,
    createLiquidationParams,
    processPosition,
    withdrawProgressPercent,
    calculateTokensToLiquidate
  };
};
