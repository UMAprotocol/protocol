import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";

// This component is purposely kept stateless because the parent component needs to exert very detailed amounts of
// control over it, e.g., clear the form in puts on submission, disable the buttons while waiting for pending
// transactions, etc. Maintaining those bits of information as state in this component would require using more obscure
// React lifecycle methods.
class ContractInteraction extends Component {
  render() {
    const formInputs = this.props.formInputs;
    return (
      <div>
        <Button onClick={this.props.remarginFn}>Remargin contract</Button>
        <div>
          <TextField value={formInputs.depositAmount} onChange={e => this.props.handleChangeFn("depositAmount", e)} />
          <Button onClick={this.props.depositFn}>Deposit</Button>
        </div>
        <div>
          <TextField value={formInputs.withdrawAmount} onChange={e => this.props.handleChangeFn("withdrawAmount", e)} />
          <Button onClick={this.props.withdrawFn}>Withdraw</Button>
        </div>
        <div>
          <TextField value={formInputs.createAmount} onChange={e => this.props.handleChangeFn("createAmount", e)} />
          <Button onClick={this.props.createFn}>Create</Button>
        </div>
        <div>
          <TextField value={formInputs.redeemAmount} onChange={e => this.props.handleChangeFn("redeemAmount", e)} />
          <Button onClick={this.props.redeemFn}>Redeem</Button>
        </div>
      </div>
    );
  }
}

export default ContractInteraction;
