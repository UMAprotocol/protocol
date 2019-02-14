import React from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import DerivativeListTable from "./DerivativeListTable.js";

import ContractDetails from "./ContractDetails.js";
import CreateContractModal from "./CreateContractModal";

class DerivativeList extends React.Component {
  state = { dataKey: null, open: false, openCreateContract: false };

  handleModalOpen = (address, e) => {
    this.setState({ open: true });
  };

  handleModalClose = () => {
    this.setState({ open: false });
  };

  handleCreateModalOpen = () => {
    this.setState({ openCreateContract: true });
  };

  handleCreateModalClose = () => {
    this.setState({ openCreateContract: false });
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

  getDerivativesData() {
    const { Registry } = this.props.drizzleState.contracts;
    const { TokenizedDerivativeCreator } = this.props.drizzle.contracts;

    const dummyDerivative = { derivativeAddress: "0x0", derivativeCreator: TokenizedDerivativeCreator.address };

    // Get the number of contracts currently in the registry.
    const derivatives = [dummyDerivative, ...Registry.getAllRegisteredDerivatives[this.state.dataKey].value];

    let derivativesData = [];
    for (let i = 0; i < derivatives.length; i++) {
      const derivative = derivatives[i];
      derivativesData.push({
        type: this.getDerivativeType(derivative.derivativeCreator),
        address: derivative.derivativeAddress,
        id: i + 1
      });
    }
    return derivativesData;
  }

  render() {
    const { Registry } = this.props.drizzleState.contracts;

    // If the cache key we received earlier isn't in the store yet; the initial value is still being fetched.
    if (!(this.state.dataKey in Registry.getAllRegisteredDerivatives)) {
      return <span>Fetching...</span>;
    }

    const derivatives = this.getDerivativesData();

    return (
      <div className="DerivativeList">
        Sponsor DApp
        <Dialog open={this.state.open} onClose={this.handleModalClose} aria-labelledby="contract-details">
          <DialogTitle>Contract Details</DialogTitle>
          <DialogContent>
            <ContractDetails />
          </DialogContent>
        </Dialog>
        <CreateContractModal open={this.state.openCreateContract} onClose={this.handleCreateModalClose} />
        <DerivativeListTable derivatives={derivatives} buttonPushFn={this.handleModalOpen} />
        <Button variant="contained" color="primary" onClick={this.handleCreateModalOpen}>
          Create New Token Contract
        </Button>
      </div>
    );
  }
}

export default DerivativeList;
