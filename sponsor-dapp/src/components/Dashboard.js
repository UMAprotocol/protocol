import React from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";

import DerivativeList from "./DerivativeList.js";
import ContractDetails from "./ContractDetails.js";
import CreateContractModal from "./CreateContractModal";

class Dashboard extends React.Component {
  state = { contractDetailsOpen: false, openModalContractAddress: null, createContractOpen: false };

  handleDetailsModalOpen = (address) => {
    this.setState({ contractDetailsOpen: true, openModalContractAddress: address });
  };

  handleDetailsModalClose = () => {
    this.setState({ contractDetailsOpen: false });
  };

  handleCreateModalOpen = () => {
    this.setState({ createContractOpen: true });
  };

  handleCreateModalClose = () => {
    this.setState({ createContractOpen: false });
  };

  render() {
    return (
      <div className="Dashboard">
        Sponsor DApp
        <Dialog open={this.state.contractDetailsOpen} onClose={this.handleDetailsModalClose} aria-labelledby="contract-details">
          <DialogTitle>Contract Details</DialogTitle>
          <DialogContent>
            <ContractDetails
              contractAddress={this.state.openModalContractAddress}
              drizzle={this.props.drizzle}
              drizzleState={this.props.drizzleState}
            />
          </DialogContent>
        </Dialog>
        <CreateContractModal open={this.state.createContractOpen} onClose={this.handleCreateModalClose} />
        <DerivativeList
          drizzle={this.props.drizzle}
          drizzleState={this.props.drizzleState}
          buttonPushFn={this.handleDetailsModalOpen}
        />
        <Button variant="contained" color="primary" onClick={this.handleCreateModalOpen}>
          Create New Token Contract
        </Button>
      </div>
    );
  }
}

export default Dashboard;
