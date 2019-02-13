import React, { Component } from 'react';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import './App.css';
import ContractDetails from './components/ContractDetails.js';

class App extends Component {
  state = {
    open: false
  };

  handleModalOpen = () => {
    this.setState({ open: true });
  };

  handleModalClose = () => {
    this.setState({ open: false} );
  };

  render() {
    return (
      <div className="App">
        Sponsor DApp
        <Button onClick={this.handleModalOpen}>
          Open contract details
        </Button>
        <Dialog
          open={this.state.open}
          onClose={this.handleModalClose}
          aria-labelledby="contract-details"
        >
          <DialogTitle>
            Contract Details
          </DialogTitle>
          <DialogContent>
            <ContractDetails />
          </DialogContent>
        </Dialog>
      </div>
    );
  }
}

export default App;
