import React, { Component } from "react";
import Button from "@material-ui/core/Button";

class TokenPreapproval extends Component {
  render() {
    return (
      <div>
        You must first authorize the contract to accept ERC-20 tokens from your wallet in order to redeem tokens you
        create and hold.
        <Button disabled={!this.props.isInteractionEnabled} onClick={this.props.approveDerivativeTokensFn}>
          {" "}
          Authorize this contract to allow you to redeem {this.props.tokenSymbol} tokens for{" "}
          {this.props.marginCurrencySymbol} in the future
        </Button>
      </div>
    );
  }
}

export default TokenPreapproval;
