import React from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";

class DerivativeList extends React.Component {
  state = { dataKey: null, open: false };

  handleModalOpen = () => {
    this.setState({ open: true });
  };

  handleModalClose = () => {
    this.setState({ open: false });
  };

  componentDidMount() {
    const { Registry } = this.props.drizzle.contracts;

    // Get and save the key for the variable we are interested in.
    const dataKey = Registry.methods.getAllRegisteredDerivatives.cacheCall();
    this.setState({ dataKey });
  }

  getDerivativeType(creatorAddress) {
    const { TokenizedDerivativeCreator } = this.props.drizzle.contracts;
    const { web3 } = this.props.drizzle;

    // Get address checksum.
    const creatorAddressChecksum = web3.utils.toChecksumAddress(creatorAddress);

    // Compare checksum against known creators.
    if (creatorAddressChecksum === web3.utils.toChecksumAddress(TokenizedDerivativeCreator.address)) {
      return "TokenizedDerivative";
    } else {
      return "Unknown";
    }
  }

  getTableData() {
    const { Registry } = this.props.drizzleState.contracts;
    const { TokenizedDerivativeCreator } = this.props.drizzle.contracts;

    const dummyDerivative = { derivativeAddress: "0x0", derivativeCreator: TokenizedDerivativeCreator.address };

    // Get the number of contracts currently in the registry.
    const derivatives = [dummyDerivative, ...Registry.getAllRegisteredDerivatives[this.state.dataKey].value];

    let data = [];
    for (let i = 0; i < derivatives.length; i++) {
      const derivative = derivatives[i];
      data.push({
        type: this.getDerivativeType(derivative.derivativeCreator),
        address: derivative.derivativeAddress,
        id: i + 1
      });
    }
    return data;
  }

  render() {
    const { Registry } = this.props.drizzleState.contracts;

    // If the cache key we received earlier isn't in the store yet; the initial value is still being fetched.
    if (!(this.state.dataKey in Registry.getAllRegisteredDerivatives)) {
      return <span>Fetching...</span>;
    }

    const data = this.getTableData();

    return (
      <div className="DerivativeList">
        Sponsor DApp
        <Dialog open={this.state.open} onClose={this.handleModalClose} aria-labelledby="contract-details">
          <DialogTitle>Contract Details</DialogTitle>
          <DialogContent>Contents of modal</DialogContent>
        </Dialog>
        <Paper align="center">
          <Table align="center">
            <TableHead>
              <TableRow>
                <TableCell padding="dense">Type</TableCell>
                <TableCell padding="dense">Address</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map(n => {
                return (
                  <TableRow key={n.id}>
                    <TableCell padding="dense">{n.type}</TableCell>
                    <TableCell padding="dense">
                      <Button onClick={this.handleModalOpen}>Open details for {n.address}</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      </div>
    );
  }
}

export default DerivativeList;
