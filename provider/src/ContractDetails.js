import React from "react";
import PropTypes from "prop-types";
import { withStyles } from "@material-ui/core/styles";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import compose from 'recompose/compose';
import withWidth from '@material-ui/core/withWidth';

const styles = {
  root: {
    width: "100%",
    overflowX: "auto"
  },
  table: {
    minWidth: 700
  }
};

class ContractDetails extends React.Component {
  state = {
    data: []
  };

  async constructTable() {
    const { tokenizedDerivative, oracle, web3, width } = this.props;

    var data = [];

    var contractAddressString;
    var oracleAddressString;
    if (width === "xs") {
      contractAddressString = tokenizedDerivative.address.substring(0,15) + "...";
      oracleAddressString = oracle.address.substring(0,15) + "..."
    } else {
      contractAddressString = tokenizedDerivative.address;
      oracleAddressString = oracle.address;
    }

    data.push({ name: "Address", value: contractAddressString, id: 0 });
    data.push({ name: "BTC/ETH Feed", value: oracleAddressString, id: 1 });

    var creationTimestamp = 1544737534;
    var date = new Date(creationTimestamp * 1000);
    var dateFormatOptions = { hour12: false, year: '2-digit', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' };
    data.push({ name: "Created", value: date.toLocaleString(undefined, dateFormatOptions), id: 2 });

    var totalSupply = (await tokenizedDerivative.totalSupply()).toString();
    var totalSupplyDecimal = web3.utils.fromWei(totalSupply, "ether");

    data.push({ name: "Total Token Supply", value: totalSupplyDecimal.substring(0,7), id: 3 });

    return data;
  }

  constructor(props) {
    super(props);

    this.state.data = [];
    this.constructTable().then(data => {
      this.setState({ data: data });
    });
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (!prevProps.deployedRegistry && this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({ data: data });
      });
    }
  }

  compnentDidMount() {
    if (this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({ data: data });
      });
    }
  }

  render() {
    const { classes } = this.props;
    return (
      <Paper align="center" className={classes.root}>
        <Table align="center" className={classes.root}>
          <TableBody>
            {this.state.data.map(n => {
              return (
                <TableRow key={n.id}>
                  <TableCell padding="dense">
                    {n.name}
                  </TableCell>
                  <TableCell padding="dense">
                    {n.value}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    );
  }
}

ContractDetails.propTypes = {
  classes: PropTypes.object.isRequired
};

export default compose(
  withStyles(styles),
  withWidth(),
)(ContractDetails);
