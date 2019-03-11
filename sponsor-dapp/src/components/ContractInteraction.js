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
        disabled={!isEnabled || !this.props.isInteractionEnabled}
        onClick={onClickHandler}
      >
        {text}
      </Button>
    );
  }

  getTokenSponsorInteraction() {
    const { drizzleHelper } = this;
    const { formInputs, contractAddress } = this.props;
    const { web3 } = this.props.drizzle;

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
    const willDefault = web3.utils.toBN(excessMargin).lt(web3.utils.toBN("0"));

    const { state } = derivativeStorage;
    const isLive = state === ContractStateEnum.LIVE;
    const isLiveNoExpiry = isLive && !pricePastExpiry;
    const aboutToExpire = isLive && pricePastExpiry;
    const isSettled = state === ContractStateEnum.SETTLED;
    const isFrozen = !isLive && !isSettled;

    let isDepositEnabled = isLiveNoExpiry || aboutToExpire;
    let isWithdrawEnabled = isLiveNoExpiry || isSettled;
    let isCreateEnabled = isLiveNoExpiry;
    let isRedeemEnabled = isLiveNoExpiry || isSettled;

    // Only deposits (which don't remargin or advance time) are enabled if a remargin would default the contract.
    if (willDefault) {
      isWithdrawEnabled = false;
      isCreateEnabled = false;
      isRedeemEnabled = false;
    }

    let middleButton;
    if (isLive) {
      if (isLiveNoExpiry) {
        // Users can remargin as long as they can't settle. Being live and able to settle is an extreme edge case
        // in which the last published time is past expiry and the oracle has already provided a price.
        middleButton = this.getButton("Remargin contract", !willDefault, this.props.remarginFn);
      } else {
        // Users must initiate remargin to transition to the expired state.
        middleButton = this.getButton("Expire contract", !willDefault, this.props.remarginFn);
      }
    } else if (isFrozen) {
      middleButton = this.getButton("Settle contract", canBeSettled, this.props.settleFn);
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
              disabled={!isDepositEnabled}
              value={formInputs.depositAmount}
              onChange={e => this.props.handleChangeFn("depositAmount", e)}
            />
            {this.getButton("Deposit", isDepositEnabled, this.props.depositFn)}
          </div>
          <div className={this.props.classes.centerButton}>{middleButton}</div>
          <div>
            <TextField
              variant="outlined"
              disabled={!isWithdrawEnabled}
              value={formInputs.withdrawAmount}
              onChange={e => this.props.handleChangeFn("withdrawAmount", e)}
            />
            {this.getButton("Withdraw", isWithdrawEnabled, this.props.withdrawFn)}
          </div>
        </div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              disabled={!isCreateEnabled}
              value={formInputs.createAmount}
              onChange={e => this.props.handleChangeFn("createAmount", e)}
            />
            {this.getButton("Create", isCreateEnabled, this.props.createFn)}
          </div>
          <div>
            <TextField
              variant="outlined"
              disabled={!isRedeemEnabled}
              value={formInputs.redeemAmount}
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
