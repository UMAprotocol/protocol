import React from "react";
import PropTypes from "prop-types";
import { withStyles } from "@material-ui/core/styles";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import TextField from "@material-ui/core/TextField";
import Button from "@material-ui/core/Button";

const styles = {
  root: {
    width: "100%",
    overflowX: "auto"
  },
  table: {
    minWidth: 700
  }
};

class DetailTable extends React.Component {
  state = {
    data: [],
    deposit: "0.0",
    withdraw: "0.0"
  };

  async updateStateWithData() {
    const { address, derivative, account, web3 } = this.props;
    var data = await this.getTableData(address, derivative, account, web3);
    this.setState({ data: data });
  }

  async remargin(props) {
    const { address, derivative, account } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.remargin({ from: account });
    this.updateStateWithData();
  }

  async deposit(props, amount) {
    const { address, derivative, account, web3 } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.deposit({ from: account, value: web3.utils.toWei(amount, "ether") });
    this.updateStateWithData();
  }

  async withdraw(props, amount) {
    const { address, derivative, account, web3 } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.withdraw(web3.utils.toWei(amount, "ether"), { from: account });
    this.updateStateWithData();
  }

  async dispute(props) {
    const { address, derivative, account } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.dispute({ from: account });
    this.updateStateWithData();
  }

  async confirmPrice(props) {
    const { address, derivative, account } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.confirmPrice({ from: account });
    this.updateStateWithData();
  }

  async settleVerifiedPrice(props) {
    const { address, derivative, account } = props;
    var deployedDerivative = derivative.at(address);
    await deployedDerivative.settle({ from: account });
    this.updateStateWithData();
  }

  constructor(props) {
    super(props);
    const { address, derivative, account, web3 } = this.props;
    this.getTableData(address, derivative, account, web3).then(data => {
      this.setState({ data: data });
    });
  }

  async getTableData(address, derivative, account, web3) {
    var deployedDerivative = derivative.at(address);
    var data = [];
    var i = 1;
    data.push({ key: "Address", value: address, id: i++ });

    var productDescription = await deployedDerivative.product({ from: account });
    data.push({ key: "Product Description", value: productDescription, id: i++ });

    var expiry = await deployedDerivative.endTime({ from: account });
    var expiryDate = new Date(Number(expiry.toString()) * 1000);
    data.push({ key: "Expiry", value: expiryDate.toString(), id: i++ });

    var lastRemarginNpv = await deployedDerivative.npv({ from: account });
    data.push({ key: "NPV on Last Remargin", value: web3.utils.fromWei(lastRemarginNpv.toString(), "ether"), id: i++ });

    var lastRemarginTime = await deployedDerivative.lastRemarginTime({ from: account });
    var lastRemarginDate = new Date(Number(lastRemarginTime.toString()) * 1000);
    data.push({ key: "Time of Last Remargin", value: lastRemarginDate.toString(), id: i++ });

    var currentState = await deployedDerivative.state({ from: account });
    var state;
    var canRemargin = false;
    var canDeposit = false;
    var canWithdraw = false;
    var canDispute = false;
    var canConfirm = false;
    var canSettle = false;

    switch (Number(currentState.toString())) {
      case 0:
        state = "Prefunded";
        canDeposit = true;
        canWithdraw = true;
        break;
      case 1:
        state = "Live";
        canRemargin = true;
        canDeposit = true;
        canWithdraw = true;
        canDispute = true;
        break;
      case 2:
        state = "Disputed";
        canConfirm = true;
        canSettle = true;
        break;
      case 3:
        state = "Expired";
        canDispute = true;
        canConfirm = true;
        canSettle = true;
        break;
      case 4:
        state = "Defaulted";
        canDispute = true;
        canConfirm = true;
        canSettle = true;
        break;
      case 5:
        state = "Settled";
        canWithdraw = true;
        break;
      default:
        state = "Invalid or unknown state returned by contract";
    }
    data.push({ key: "Contract State", value: state, id: i++ });

    var valueIfRemarginedImmediately = await deployedDerivative.npvIfRemarginedImmediately({ from: account });
    data.push({
      key: "NPV if Remargined Immediately",
      value: web3.utils.fromWei(valueIfRemarginedImmediately.toString(), "ether"),
      id: i++
    });

    var minMargin = await deployedDerivative.requiredMargin({ from: account });
    data.push({ key: "Minimum Margin (ETH)", value: web3.utils.fromWei(minMargin.toString(), "ether"), id: i++ });

    var takerStruct = await deployedDerivative.taker({ from: account });
    var makerStruct = await deployedDerivative.maker({ from: account });

    var userStruct;
    var counterpartyStruct;
    if (takerStruct[0].toString().toLowerCase() === account.toString().toLowerCase()) {
      userStruct = takerStruct;
      counterpartyStruct = makerStruct;
    } else {
      userStruct = makerStruct;
      counterpartyStruct = takerStruct;
    }
    var yourMargin = userStruct[1];
    data.push({ key: "Your Margin Balance (ETH)", value: web3.utils.fromWei(yourMargin.toString(), "ether"), id: i++ });

    var counterpartyMargin = counterpartyStruct[1];
    data.push({
      key: "Counterparty Margin Balance (ETH)",
      value: web3.utils.fromWei(counterpartyMargin.toString(), "ether"),
      id: i++
    });

    data.push({
      key: "TODO(mrice32): move everything below to a separate non-table UI element",
      value: "---------------------------------",
      id: i++
    });

    data.push({
      key: "Would you like to remargin?",
      buttonValue: () => {
        this.remargin(this.props);
      },
      value: "Remargin",
      enabled: canRemargin,
      id: i++
    });

    data.push({
      key: "deposit",
      formValue: "ETH to Deposit",
      buttonValue: () => {
        this.deposit(this.props, this.state.deposit);
      },
      value: "Deposit",
      enabled: canDeposit,
      id: i++
    });

    data.push({
      key: "withdraw",
      formValue: "ETH to Widthdraw",
      buttonValue: () => {
        this.withdraw(this.props, this.state.withdraw);
      },
      value: "Withdraw",
      enabled: canWithdraw,
      id: i++
    });

    data.push({
      key: "Would you like to dispute the most recent NPV?",
      buttonValue: () => {
        this.dispute(this.props);
      },
      value: "Dispute",
      enabled: canDispute,
      id: i++
    });

    data.push({
      key: "Would you like to confirm the current NPV for settlement?",
      buttonValue: () => {
        this.confirmPrice(this.props);
      },
      value: "Confirm",
      enabled: canConfirm,
      id: i++
    });

    data.push({
      key: "Would you like to settle (verified price must be ready at the expiry)?",
      buttonValue: () => {
        this.settleVerifiedPrice(this.props);
      },
      value: "Settle",
      enabled: canSettle,
      id: i++
    });

    return data;
  }

  getDescription(element) {
    if (element.formValue && element.key === "deposit") {
      return (
        <TextField
          id="quantity"
          name="quantity"
          label={element.formValue}
          fullWidth
          value={this.state.deposit}
          onChange={event => {
            if (!isNaN(event.target.value)) {
              this.setState({ deposit: event.target.value });
            }
          }}
        />
      );
    } else if (element.formValue && element.key === "withdraw") {
      return (
        <TextField
          id="withdraw"
          name="withdraw"
          label={element.formValue}
          fullWidth
          value={this.state.withdraw}
          onChange={event => {
            if (!isNaN(event.target.value)) {
              this.setState({ withdraw: event.target.value });
            }
          }}
        />
      );
    } else {
      return element.key;
    }
  }

  getValue(element) {
    if (element.buttonValue) {
      return (
        <Button
          className={this.props.classes.button}
          onClick={element.buttonValue}
          disabled={!element.enabled}
          color="primary"
        >
          {element.value}
        </Button>
      );
    } else {
      return element.value;
    }
  }

  render() {
    const { classes } = this.props;

    return (
      <Paper className={classes.root}>
        <Table className={classes.table}>
          <TableBody>
            {this.state.data.map(n => {
              return (
                <TableRow key={n.id}>
                  <TableCell component="th" scope="row">
                    {this.getDescription(n)}
                  </TableCell>
                  <TableCell numeric>{this.getValue(n)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    );
  }
}

DetailTable.propTypes = {
  classes: PropTypes.object.isRequired
};

export default withStyles(styles)(DetailTable);
