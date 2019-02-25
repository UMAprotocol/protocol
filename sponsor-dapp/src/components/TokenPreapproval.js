import React, { Component } from "react";
import Button from "@material-ui/core/Button";

class TokenPreapproval extends Component {
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
          <Button disabled={!this.props.isInteractionEnabled} onClick={this.props.approveMarginCurrencyFn}>
            Approve margin currency
          </Button>
        )}
        {!this.props.isDerivativeTokenAuthorized && (
          <Button disabled={!this.props.isInteractionEnabled} onClick={this.props.approveDerivativeTokensFn}>
            Approve derivative tokens
          </Button>
        )}
      </div>
    );
  }
}

export default TokenPreapproval;
