import React from 'react';
import PropTypes from 'prop-types';
import { withStyles } from '@material-ui/core/styles';
import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Paper from '@material-ui/core/Paper';
import Button from '@material-ui/core/Button';

const styles = {
  root: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    minWidth: 700,
  },
};

class SimpleTable extends React.Component {

  state = {};

  async constructTable() {

    const { deployedRegistry, account, derivative } = this.props;

    var data = []

    if (deployedRegistry) {
      var contractCount = await deployedRegistry.getNumRegisteredContracts({from: account});
      var i;
      var data = [];
      for (i = 0; i < contractCount.c[0]; i++) {
          var address = await deployedRegistry.getRegisteredContract(i, account, {from: account});
          var deployedDerivative = derivative.at(address);
          var product = await deployedDerivative._product({from: account});
          data.push({product:product, address:address, id:i});
      }
    }

    return data;
  }

  constructor(props) {
    super(props);
    this.addressCaller = (fn, address) => {
      return () => {
        fn(address);
      }
    };

    this.state.data = [];
    this.constructTable().then(data => {
        this.setState({data:data});
    });
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (!prevProps.deployedRegistry && this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({data:data});
      });
    }
  }

  compnentDidMount() {
    if (this.props.deployedRegistry) {
      this.constructTable().then(data => {
        this.setState({data:data});
      });
    }
  }


  render() {
    const { classes, didTapAddress } = this.props;
    return ( 
      <Paper className={classes.root}>
        <Table className={classes.table}>
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell numeric>Address</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {this.state.data.map(n => {
              return (
                <TableRow key={n.id}>
                  <TableCell component="th" scope="row">
                    {n.product}
                  </TableCell>
                  <TableCell numeric>
                    <Button className={classes.button} onClick={this.addressCaller(didTapAddress, n.address)} color="primary">{n.address}</Button>
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

SimpleTable.propTypes = {
  classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(SimpleTable);

