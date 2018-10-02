import React from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Paper from '@material-ui/core/Paper';

import BigNumber from 'bignumber.js';

const styles = {
  root: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    minWidth: 700,
  },
};

let id = 0;
function createData(name, calories, fat, carbs, protein) {
  id += 1;
  return { id, name, calories, fat, carbs, protein };
}


class DetailTable extends React.Component {


  state = {
    data:[]
  };

  constructor(props) {
    super(props);
    const { address, derivative, account, web3 } = this.props;
    this.getTableData(address, derivative, account, web3).then(data => {
      this.setState({data:data});
    });
  }

  async getTableData(address, derivative, account, web3) {
    var deployedDerivative = derivative.at(address);
    var data = [];
    var i = 1;
    data.push({key:"Address", value:address, id:i++})

    var productDescription = await deployedDerivative._product({from:account});
    data.push({key:"Product Description", value:productDescription, id:i++});

    var expiry = await deployedDerivative.endTime({from:account});
    var expiryDate = new Date(Number(expiry.toString()) * 1000);
    data.push({key:"Expiry", value:expiryDate.toString(), id:i++});


    var lastRemarginNpv = await deployedDerivative.npv({from:account});
    data.push({key:"NPV on Last Remargin", value:web3.utils.fromWei(lastRemarginNpv.toString(), 'ether'), id:i++});

    var lastRemarginTime = await deployedDerivative.lastRemarginTime({from:account});
    var lastRemarginDate = new Date(Number(lastRemarginTime.toString()) * 1000);
    data.push({key:"Time of Last Remargin", value:lastRemarginDate.toString(), id:i++});

    var currentState = await deployedDerivative.state({from:account});
    var state = "Unknown";
    switch(Number(currentState.toString())) {
      case 0:
        state = "Prefunded";
        break;
      case 1:
        state = "Live";
        break;
      case 2:
        state = "Disputed";
        break;
      case 3:
        state = "Expired"
        break;
      case 4:
        state = "Defaulted";
        break;
      case 5:
        state = "Settled";
      default:
        state = "Invalid or unknown state returned by contract";
    }
    data.push({key:"Contract State", value:state, id:i++});


    var valueIfRemarginedImmediately = await deployedDerivative.npvIfRemarginedImmediately({from:account});
    data.push({key:"NPV if Remargined Immediately", value:web3.utils.fromWei(valueIfRemarginedImmediately.toString(), 'ether'), id:i++});


    var minMargin = await deployedDerivative.requiredMargin({from:account});
    data.push({key:"Minimum Margin (ETH)", value:web3.utils.fromWei(minMargin.toString(), 'ether'), id:i++});

    var yourMargin = await deployedDerivative.balances(account, {from:account});
    data.push({key:"Your Margin Balance (ETH)", value:web3.utils.fromWei(yourMargin.toString(), 'ether'), id:i++});

    var counterpartyAddress = await deployedDerivative.counterpartyAddress({from:account});
    var counterpartyMargin = await deployedDerivative.balances(counterpartyAddress, {from:account});
    data.push({key:"Counterparty Margin Balance (ETH)", value:web3.utils.fromWei(counterpartyMargin.toString(), 'ether'), id:i++});

    return data;
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
                    {n.key}
                  </TableCell>
                  <TableCell numeric>{n.value}</TableCell>
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
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(DetailTable);
