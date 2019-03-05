import React, { Component } from "react";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import { withStyles } from "@material-ui/core/styles";

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
    const formInputs = this.props.formInputs;
    return (
      <div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              className={this.props.classes.textField}
              disabled={!this.props.isInteractionEnabled}
              value={formInputs.depositAmount}
              onChange={e => this.props.handleChangeFn("depositAmount", e)}
            />
            {this.getButton("Deposit", this.props.isInteractionEnabled, this.props.depositFn)}
          </div>
          <div className={this.props.classes.centerButton}>
            {this.getButton("Remargin contract", this.props.isInteractionEnabled, this.props.remarginFn)}
          </div>
          <div>
            <TextField
              variant="outlined"
              disabled={!this.props.isInteractionEnabled}
              value={formInputs.withdrawAmount}
              onChange={e => this.props.handleChangeFn("withdrawAmount", e)}
            />
            {this.getButton("Withdraw", this.props.isInteractionEnabled, this.props.withdrawFn)}
          </div>
        </div>
        <div className={this.props.classes.rowOne}>
          <div>
            <TextField
              variant="outlined"
              disabled={!this.props.isInteractionEnabled}
              value={formInputs.createAmount}
              onChange={e => this.props.handleChangeFn("createAmount", e)}
            />
            {this.getButton("Create", this.props.isInteractionEnabled, this.props.createFn)}
          </div>
          <div>
            <TextField
              variant="outlined"
              disabled={!this.props.isInteractionEnabled}
              value={formInputs.redeemAmount}
              onChange={e => this.props.handleChangeFn("redeemAmount", e)}
            />
            {this.getButton("Redeem", this.props.isInteractionEnabled, this.props.redeemFn)}
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
