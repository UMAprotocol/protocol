import React, { Component } from "react";
import Typography from "@material-ui/core/Typography";
import { currencyAddressToName } from "../utils/ParameterLookupUtils.js";
import Grid from "@material-ui/core/Grid";
import DrizzleHelper from "../utils/DrizzleHelper";
import Button from "@material-ui/core/Button";
import { withStyles } from "@material-ui/core/styles";

const styles = theme => ({
  button: {
    height: 56,
    margin: 10,
    width: 800
  }
});

class TokenPreapproval extends Component {
  getButton(text, isEnabled, onClickHandler) {
    return (
      <Button
        variant="contained"
        color="primary"
        className={this.props.classes.button}
        disabled={!isEnabled}
        onClick={onClickHandler}
      >
        {text}
      </Button>
    );
  }

  componentWillMount() {
    this.drizzleHelper = new DrizzleHelper(this.props.drizzle);
  }

  render() {
    const { drizzleHelper } = this;
    const { contractAddress, params } = this.props;

    const derivativeStorage = drizzleHelper.getCache(contractAddress, "derivativeStorage", []);
    const marginCurrencyName = currencyAddressToName(params, derivativeStorage.externalAddresses.marginCurrency);
    const marginCurrencyText = marginCurrencyName ? " " + marginCurrencyName : "";

    // There are effectively two configuration booleans: isMarginCurrencyAuthorized and isDerivativeTokenAuthorized.
    // In the case of ETH as margin currency, isMarginCurrencyAuthorized can be taken to be true.
    let copy;
    if (this.props.isMarginCurrencyAuthorized && this.props.isDerivativeTokenAuthorized) {
      // No preapprovals need to be obtained. Really shouldn't even try to render this component, but better to be
      // safe.
      return null;
    } else if (this.props.isMarginCurrencyAuthorized && !this.props.isDerivativeTokenAuthorized) {
      copy = (
        <div>
          You must first authorize the contract to accept ERC-20 tokens from your wallet in order to redeem tokens you
          create and hold.
        </div>
      );
    } else if (!this.props.isMarginCurrencyAuthorized && this.props.isDerivativeTokenAuthorized) {
      copy = (
        <div>
          You must first authorize the contract to accept ERC-20 tokens from your wallet in order to create tokens or
          deposit margin.
        </div>
      );
    } else {
      copy = (
        <div>
          You must first authorize the contract to accept ERC-20 tokens from your wallet in order to create tokens,
          redeem tokens, deposit margin, or withdraw margin.
        </div>
      );
    }
    return (
      <Grid
        container
        spacing={16}
        direction="column"
        alignItems="center"
        align="center"
        className={this.props.classes.root}
      >
        <div>
          <Typography variant="body2">{copy}</Typography>
        </div>
        <div>
          {!this.props.isMarginCurrencyAuthorized &&
            this.getButton(
              "Authorize " + marginCurrencyText + " as margin currency",
              this.props.isInteractionEnabled,
              this.props.approveMarginCurrencyFn
            )}
        </div>
        <div>
          {!this.props.isDerivativeTokenAuthorized &&
            this.getButton(
              "Authorize contract to redeem " + derivativeStorage.fixedParameters.symbol + " for " + marginCurrencyText,
              this.props.isInteractionEnabled,
              this.props.approveDerivativeTokensFn
            )}
        </div>
      </Grid>
    );
  }
}

export default withStyles(styles)(TokenPreapproval);
