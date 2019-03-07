import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import { withStyles } from "@material-ui/core/styles";

import DrizzleHelper from "../utils/DrizzleHelper";
import { ContractStateEnum } from "../utils/TokenizedDerivativeUtils";

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
        variant="outlined"
        color="primary"
        className={this.props.classes.button}
        disabled={!isEnabled}
        onClick={onClickHandler}
      >
        {text}
      </Button>
    );
  }

  getTokenSponsorInteraction() {
    const { drizzleHelper } = this;
    const { formInputs, contractAddress, isInteractionEnabled } = this.props;

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);

    // pricePastExpiry simply denotes that the price feed published a time past expiry.
    // A contract can be past expiry and not in the expired state (i.e. live or settled).
    // Must be in sync: https://github.com/UMAprotocol/protocol/blob/84d2e693de06d3b76e266e5b79951174bea4eb85/contracts/TokenizedDerivative.sol#L456
    const priceFeedAddress = derivativeStorage.externalAddresses.priceFeed;
    const identifierBytes = derivativeStorage.fixedParameters.product;
    const latestPrice = drizzleHelper.getCache(priceFeedAddress, "latestPrice", [identifierBytes]);
    const pricePastExpiry = derivativeStorage.endTime <= latestPrice.publishTime;

    const canBeSettled = drizzleHelper.getCache(contractAddress, "canBeSettled", []);

    const { state } = derivativeStorage;
    const isLive = state === ContractStateEnum.LIVE;
    const isSettled = state === ContractStateEnum.SETTLED;
    const isLiveOrSettled = isLive || isSettled;

    const isDepositDisabled = !isInteractionEnabled || !isLive;
    const isWithdrawDisabled = !isInteractionEnabled || (isLive && pricePastExpiry) || !isLiveOrSettled;
    const isCreateDisabled = !isInteractionEnabled || (isLive && pricePastExpiry) || !isLive;
    const isRedeemDisabled = !isInteractionEnabled || (isLive && pricePastExpiry) || !isLiveOrSettled;

    let middleButton;
    if (isLive && !pricePastExpiry && !canBeSettled) {
      // Users can remargin as long as they can't settle. Being live and able to settle is an extreme edge case
      // in which the last published time is past expiry and the oracle has already provided a price.
      middleButton = this.getButton("Remargin contract", isInteractionEnabled, this.props.remarginFn);
    } else if (isLive && pricePastExpiry) {
      // Users must initiate remargin to transition to the expired state.
      middleButton = this.getButton("Expire contract", isInteractionEnabled, this.props.remarginFn);
    } else if (!isSettled) {
      middleButton = this.getButton("Settle contract", isInteractionEnabled && canBeSettled, this.props.settleFn);
    } else {
      // Render a placeholder button that's always disabled for settled contracts.
      middleButton = this.getButton("Remargin contract", false, null);
    }

    return (
      <div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              className={this.props.classes.textField}
              disabled={this.props.isDepositDisabled}
              value={formInputs.depositAmount}
              onChange={e => this.props.handleChangeFn("depositAmount", e)}
            />
            {this.getButton("Deposit", !isDepositDisabled, this.props.depositFn)}
          </div>
          <div className={this.props.classes.centerButton}>{middleButton}</div>
          <div>
            <TextField
              variant="outlined"
              disabled={isWithdrawDisabled}
              value={formInputs.withdrawAmount}
              onChange={e => this.props.handleChangeFn("withdrawAmount", e)}
            />
            {this.getButton("Withdraw", !isWithdrawDisabled, this.props.withdrawFn)}
          </div>
        </div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              disabled={isCreateDisabled}
              value={formInputs.createAmount}
              onChange={e => this.props.handleChangeFn("createAmount", e)}
            />
            {this.getButton("Create", !isCreateDisabled, this.props.createFn)}
          </div>
          <div>
            <TextField
              variant="outlined"
              disabled={isRedeemDisabled}
              value={formInputs.redeemAmount}
              onChange={e => this.props.handleChangeFn("redeemAmount", e)}
            />
            {this.getButton("Redeem", !isRedeemDisabled, this.props.redeemFn)}
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
