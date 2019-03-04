import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import { withStyles } from "@material-ui/core/styles";

const styles = theme => ({
  button: {
    height: 56,
      margin: 10,
    width: 198
  },
});

class TokenPreapproval extends Component {
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

  render() {
    // There are effectively two configuration booleans: isMarginCurrencyAuthorized and isDerivativeTokenAuthorized.
    // In the case of ETH as margin currency, isMarginCurrencyAuthorized can be taken to be true.
    // TODO(ptare): Obtain final copy.
    let copy;
    if (this.props.isMarginCurrencyAuthorized && this.props.isDerivativeTokenAuthorized) {
      // No preapprovals need to be obtained. Really shouldn't even try to render this component, but better to be
      // safe.
      return null;
    } else if (this.props.isMarginCurrencyAuthorized && !this.props.isDerivativeTokenAuthorized) {
      copy = <div>You need to authorize derivative tokens!</div>;
    } else if (!this.props.isMarginCurrencyAuthorized && this.props.isDerivativeTokenAuthorized) {
      copy = <div>You need to authorize margin currency!</div>;
    } else {
      copy = <div>You need to authorize both!</div>;
    }
    return (
      <div>
        {copy}
        {!this.props.isMarginCurrencyAuthorized && (
            this.getButton("Approve margin currency", this.props.isInteractionEnabled, this.props.approveMarginCurrencyFn)
        )}
        {!this.props.isDerivativeTokenAuthorized && (
            this.getButton("Approve derivative tokens", this.props.isInteractionEnabled, this.props.approveDerivativeTokensFn)
        )}
      </div>
    );
  }
}

export default withStyles(styles)(TokenPreapproval);
