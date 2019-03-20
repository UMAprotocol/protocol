import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import InputAdornment from "@material-ui/core/InputAdornment";
import TextField from "@material-ui/core/TextField";
import { withStyles } from "@material-ui/core/styles";

import { ContractStateEnum } from "../utils/TokenizedDerivativeUtils";
import DrizzleHelper from "../utils/DrizzleHelper";
import { currencyAddressToName } from "../utils/ParameterLookupUtils.js";
import { formatWei } from "../utils/FormattingUtils";

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

  getTokenSponsorInteraction() {
    const { drizzleHelper } = this;
    const { formInputs, contractAddress, estimatedCreateCurrency, params, isInteractionEnabled } = this.props;
    const { web3 } = this.props.drizzle;
    const account = this.props.drizzle.store.getState().accounts[0];

    const zero = web3.utils.toBN("0");

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);

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
      depositHelper = excessMargin
        ? "Deposit at least " + formatWei(web3.utils.toBN(excessMargin).muln(-1), web3) + marginCurrencyText
        : "";
    } else {
      withdrawHelper = excessMargin ? formatWei(excessMargin, web3) + marginCurrencyText + " available" : "";
    }
    const createHelper = estimatedCreateCurrency
      ? "Est. " + formatWei(estimatedCreateCurrency, web3) + " " + marginCurrencyText
      : "";

    // Check if the contract is empty (e.g., initial creation) and disallow withdrawals in that case. The logic to
    // prevent withdrawing into default is handled separately.
    const anyBalanceToWithdraw = web3.utils.toBN(derivativeStorage.shortBalance).gt(zero);

    const ownedTokens = drizzleHelper.getCache(contractAddress, "balanceOf", [account]);
    const anyTokensToRedeem = ownedTokens ? web3.utils.toBN(ownedTokens).gt(zero) : false;
    const redeemHelper = ownedTokens ? formatWei(ownedTokens, web3) + " token(s) available" : "";

    const { state } = derivativeStorage;
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
