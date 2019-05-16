import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import InputAdornment from "@material-ui/core/InputAdornment";
import TextField from "@material-ui/core/TextField";
import { withStyles } from "@material-ui/core/styles";

import { ContractStateEnum, ReturnTypeEnum } from "../utils/TokenizedDerivativeUtils";
import DrizzleHelper from "../utils/DrizzleHelper";
import { currencyAddressToName } from "../utils/ParameterLookupUtils.js";
import { formatWei, formatWithMaxDecimals } from "../utils/FormattingUtils";

const BigNumber = require("bignumber.js");

const styles = theme => ({
  button: {
    height: 56,
    margin: 0,
    width: 198
  },
  rowOne: {
    display: "flex",
    flexGrow: 1,
    justifyContent: "space-between",
    marginTop: 20
  },
  centerButton: {}
});

// This component is purposely kept stateless because the parent component needs to exert very detailed amounts of
// control over it, e.g., clear the form in puts on submission, disable the buttons while waiting for pending
// transactions, etc. Maintaining those bits of information as state in this component would require using more obscure
// React lifecycle methods.
class ContractInteraction extends Component {
  componentWillMount() {
    this.drizzleHelper = new DrizzleHelper(this.props.drizzle);
  }

  getButton(text, isEnabled, onClickHandler) {
    return (
      <Button
        variant="contained"
        color="primary"
        className={this.props.classes.button}
        disabled={!isEnabled || !this.props.isInteractionEnabled}
        onClick={onClickHandler}
      >
        {text}
      </Button>
    );
  }

  calcMaxTokensThatCanBeCreated() {
    const { drizzleHelper } = this;
    const { contractAddress } = this.props;
    const { web3 } = this.props.drizzle;

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);
    // TODO(ptare): Implement the equivalent computation for COMPOUND return type.
    if (derivativeStorage.fixedParameters.returnType !== ReturnTypeEnum.LINEAR) {
      return "";
    }

    const startingTokenUnderlyingRatio = BigNumber(derivativeStorage.fixedParameters.initialTokenUnderlyingRatio);
    const supportedMove = BigNumber(derivativeStorage.fixedParameters.supportedMove);
    const leverage = BigNumber(
      drizzleHelper.getCache(derivativeStorage.externalAddresses.returnCalculator, "leverage", [])
    );

    const fpScalingFactor = BigNumber(web3.utils.toWei("1", "ether"));
    const newExcessMargin = BigNumber(drizzleHelper.getCache(contractAddress, "calcExcessMargin", []));
    const updatedPriceCache = drizzleHelper.getCache(contractAddress, "getUpdatedUnderlyingPrice", []);
    if (!updatedPriceCache) {
      // If the updated price isn't available, we can't estimate the number of tokens that can be created. One case
      // in which a valid contract gets into this state is when the contract will expire on a remargin but no Oracle
      // price is available yet.
      return "";
    }
    const newUnderlyingPrice = BigNumber(updatedPriceCache.underlyingPrice);

    // Computation in Solidity will round differently, so results may slightly differ. Since this value is rounded to
    // 4 decimal places anyway, the difference in precision shouldn't matter.
    const maxTokens = newExcessMargin
      .times(fpScalingFactor)
      .times(fpScalingFactor)
      .div(startingTokenUnderlyingRatio)
      .div(newUnderlyingPrice)
      .div(supportedMove)
      .div(leverage)
      .abs();
    // Round down on the number of tokens that can be created.
    return formatWithMaxDecimals(maxTokens.toString(), 4, false);
  }

  getTokenSponsorInteraction() {
    const { drizzleHelper } = this;
    const { formInputs, contractAddress, estimatedCreateCurrency, params, isInteractionEnabled } = this.props;
    const { web3 } = this.props.drizzle;
    const account = this.props.drizzle.store.getState().accounts[0];

    const zero = web3.utils.toBN("0");

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);
    const { state } = derivativeStorage;

    // pricePastExpiry simply denotes that the price feed published a time past expiry.
    // A contract can be past expiry and not in the expired state (i.e. live or settled).
    // Must be in sync: https://github.com/UMAprotocol/protocol/blob/84d2e693de06d3b76e266e5b79951174bea4eb85/contracts/TokenizedDerivative.sol#L456
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const identifierBytes = derivativeStorage.fixedParameters.product;
    const latestPrice = drizzleHelper.getCache(priceFeedAddress, "latestPrice", [identifierBytes]);
    const pricePastExpiry = web3.utils.toBN(derivativeStorage.endTime).lte(web3.utils.toBN(latestPrice.publishTime));

    const canBeSettled = drizzleHelper.getCache(contractAddress, "canBeSettled", []);
    const excessMargin = drizzleHelper.getCache(contractAddress, "calcExcessMargin", []);
    const willDefault = excessMargin ? web3.utils.toBN(excessMargin).lt(zero) : false;

    const marginCurrencyName = currencyAddressToName(params, derivativeStorage.externalAddresses.marginCurrency);
    const marginCurrencyText = marginCurrencyName ? " " + marginCurrencyName : "";

    let withdrawHelper = "";
    let depositHelper = "";
    if (willDefault) {
      // Round up on the deposit requirement.
      depositHelper = excessMargin
        ? "Deposit at least " +
          formatWithMaxDecimals(formatWei(web3.utils.toBN(excessMargin).muln(-1), web3), 4, true) +
          marginCurrencyText
        : "";
    } else {
      // Round down on the amount available for withdrawal.
      withdrawHelper = excessMargin
        ? formatWithMaxDecimals(formatWei(excessMargin, web3), 4, false) + " available"
        : "";
    }

    // Round up on the amount of margin that will be required to create the tokens.
    const estimatedCostNumber = estimatedCreateCurrency
      ? formatWithMaxDecimals(formatWei(estimatedCreateCurrency, web3), 4, true)
      : "";
    const createEstimatedCost = estimatedCreateCurrency ? (
      <div>
        Est. cost {estimatedCostNumber} {marginCurrencyText}
      </div>
    ) : (
      ""
    );

    const maxTokensThatCanBeCreated = state === ContractStateEnum.LIVE ? this.calcMaxTokensThatCanBeCreated() : 0;
    const createMaxTokens = maxTokensThatCanBeCreated ? <div>Max {maxTokensThatCanBeCreated} tokens</div> : "";
    const createHelper = (
      <div>
        {createMaxTokens}
        {createEstimatedCost}
      </div>
    );

    // Check if the contract is empty (e.g., initial creation) and disallow withdrawals in that case. The logic to
    // prevent withdrawing into default is handled separately.
    const anyBalanceToWithdraw = web3.utils.toBN(derivativeStorage.shortBalance).gt(zero);

    const ownedTokens = drizzleHelper.getCache(contractAddress, "balanceOf", [account]);
    const anyTokensToRedeem = ownedTokens ? web3.utils.toBN(ownedTokens).gt(zero) : false;

    // Round down on the number of tokens that can be redeemed.
    const redeemHelper = ownedTokens
      ? formatWithMaxDecimals(formatWei(ownedTokens, web3), 4, false) + " available"
      : "";

    const isLive = state === ContractStateEnum.LIVE;
    const isLiveNoExpiry = isLive && !pricePastExpiry;
    const aboutToExpire = isLive && pricePastExpiry;
    const isSettled = state === ContractStateEnum.SETTLED;
    const isFrozen = !isLive && !isSettled;

    // Contract operations are only enabled in certain states.
    let isDepositEnabled = (isLiveNoExpiry || aboutToExpire) && isInteractionEnabled;
    let isWithdrawEnabled = (isLiveNoExpiry || isSettled) && anyBalanceToWithdraw && isInteractionEnabled;
    let isCreateEnabled = isLiveNoExpiry && isInteractionEnabled;
    let isRedeemEnabled = (isLiveNoExpiry || isSettled) && anyTokensToRedeem && isInteractionEnabled;

    // If operations are disabled in states that we would expect them to be enabled, this message explains what's going
    // on.
    let warningMessage = "";
    let middleButton;
    if (isLiveNoExpiry) {
      // Users can remargin as long as they can't settle. Being live and able to settle is an extreme edge case
      // in which the last published time is past expiry and the oracle has already provided a price.
      middleButton = this.getButton("Remargin contract", !willDefault, this.props.remarginFn);
      // Only deposits (which don't remargin or advance time) are enabled if a remargin would default the contract.
      if (willDefault) {
        warningMessage = <div className={this.props.classes.warning}>Please deposit to avoid a default</div>;
        isWithdrawEnabled = false;
        isCreateEnabled = false;
        isRedeemEnabled = false;
      }
    } else if (aboutToExpire) {
      // Users must initiate remargin to transition to the expired state. The edge case from above applies, if the
      // Oracle price is available and would default the contract, we should probably disable this button.
      middleButton = this.getButton("Expire contract", true, this.props.remarginFn);
    } else if (isFrozen) {
      if (!canBeSettled) {
        warningMessage = (
          <div className={this.props.classes.warning}>Please wait for an Oracle price to settle the contract</div>
        );
      }
      middleButton = this.getButton("Settle contract", canBeSettled, this.props.settleFn);
    } else {
      // Render a placeholder button that's always disabled for settled contracts.
      middleButton = this.getButton("Remargin contract", false, null);
    }

    // We have to embed inputProps inside of InputProps, otherwise ESLint thinks we are passing duplicate props.
    const marginCurrencyInputProps = {
      inputProps: { style: { textAlign: "right", width: "152px" } },
      endAdornment: <InputAdornment position="end">{marginCurrencyText}</InputAdornment>
    };
    const tokenInputProps = {
      inputProps: { style: { textAlign: "right", width: "132px" } },
      endAdornment: <InputAdornment position="end">tokens</InputAdornment>
    };

    return (
      <div>
        {warningMessage}
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              className={this.props.classes.textField}
              disabled={!isDepositEnabled}
              value={formInputs.depositAmount}
              InputProps={marginCurrencyInputProps}
              helperText={depositHelper}
              type="number"
              onChange={e => this.props.handleChangeFn("depositAmount", e)}
            />
            {this.getButton("Deposit", isDepositEnabled, this.props.depositFn)}
          </div>
          <div className={this.props.classes.centerButton}>{middleButton}</div>
          <div>
            <TextField
              variant="outlined"
              disabled={!isCreateEnabled}
              value={formInputs.createAmount}
              InputProps={tokenInputProps}
              FormHelperTextProps={{ component: "div" }}
              helperText={createHelper}
              type="number"
              onChange={e => this.props.handleChangeFn("createAmount", e)}
            />
            {this.getButton("Create", isCreateEnabled, this.props.createFn)}
          </div>
        </div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              disabled={!isWithdrawEnabled}
              value={formInputs.withdrawAmount}
              InputProps={marginCurrencyInputProps}
              helperText={withdrawHelper}
              type="number"
              onChange={e => this.props.handleChangeFn("withdrawAmount", e)}
            />
            {this.getButton("Withdraw", isWithdrawEnabled, this.props.withdrawFn)}
          </div>
          <div>
            <TextField
              variant="outlined"
              disabled={!isRedeemEnabled}
              value={formInputs.redeemAmount}
              InputProps={tokenInputProps}
              helperText={redeemHelper}
              type="number"
              onChange={e => this.props.handleChangeFn("redeemAmount", e)}
            />
            {this.getButton("Redeem", isRedeemEnabled, this.props.redeemFn)}
          </div>
        </div>
      </div>
    );
  }

  getTokenHolderInteraction() {
    return (
      <div>
        <TextField
          variant="outlined"
          disabled={!this.props.isInteractionEnabled}
          value={this.props.formInputs.redeemAmount}
          onChange={e => this.props.handleChangeFn("redeemAmount", e)}
        />
        {this.getButton("Redeem", this.props.isInteractionEnabled, this.props.redeemFn)}
      </div>
    );
  }

  render() {
    if (this.props.isTokenSponsor) {
      return this.getTokenSponsorInteraction();
    } else {
      return this.getTokenHolderInteraction();
    }
  }
}

export default withStyles(styles)(ContractInteraction);
