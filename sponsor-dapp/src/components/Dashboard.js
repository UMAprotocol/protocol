import React from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";

import DerivativeList from "./DerivativeList.js";
import ContractDetails from "./ContractDetails.js";
import CreateContractModal from "./CreateContractModal";

class Dashboard extends React.Component {
  state = { open: false, openCreateContract: false };

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

  render() {
    return (
      <div className="Dashboard">
        Sponsor DApp
        <Dialog open={this.state.open} onClose={this.handleModalClose} aria-labelledby="contract-details">
          <DialogTitle>Contract Details</DialogTitle>
          <DialogContent>
            <ContractDetails />
          </DialogContent>
        </Dialog>
        <CreateContractModal open={this.state.openCreateContract} onClose={this.handleCreateModalClose} />
        <DerivativeList
          drizzle={this.props.drizzle}
          drizzleState={this.props.drizzleState}
          buttonPushFn={this.handleModalOpen}
        />
        <Button variant="contained" color="primary" onClick={this.handleCreateModalOpen}>
          Create New Token Contract
        </Button>
      </div>
    );
  }
}

export default Dashboard;
