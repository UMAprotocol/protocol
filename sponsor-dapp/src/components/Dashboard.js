import React from "react";
import AppBar from "@material-ui/core/AppBar";
import Button from "@material-ui/core/Button";
import CssBaseline from "@material-ui/core/CssBaseline";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import Grid from "@material-ui/core/Grid";
import Toolbar from "@material-ui/core/Toolbar";
import Typography from "@material-ui/core/Typography";
import grey from "@material-ui/core/colors/grey";
import { withStyles } from "@material-ui/core/styles";

import ContractDetails from "./ContractDetails";
import CreateContractModal from "./CreateContractModal";
import DerivativeList from "./DerivativeList";

import AddressWhitelist from "../contracts/AddressWhitelist.json";

const styles = theme => ({
  root: {
    display: "flex",
    width: "100%"
  },
  icon: {
    marginRight: "10px"
  },
  toolbar: {
    paddingRight: 24 // keep right padding when drawer closed
  },
  appBar: {
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen
    }),
    backgroundColor: grey[100],
    color: "black"
  },
  appBarSpacer: theme.mixins.toolbar,
  content: {
    flexGrow: 1,
    padding: theme.spacing.unit * 3,
    height: "100vh",
    overflow: "auto"
  },
  tableContainer: {
    height: "flex"
  },
  title: {
    flexGrow: 1
  },
  contractDetailsModal: {
    padding: 10
  },
  createButton: {
    marginTop: "8px"
  }
});

class Dashboard extends React.Component {
  state = {
    contractDetailsOpen: false,
    openModalContractAddress: null,
    createContractOpen: false,
    isCreateDisabled: true
  };

  handleDetailsModalOpen = address => {
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

  componentDidMount() {
    this.verifySponsorEligible();
  }

  verifySponsorEligible() {
    // Get TokenizedDerivativeCreator's sponsorWhitelist address
    const { drizzle } = this.props;
    const { TokenizedDerivativeCreator } = drizzle.contracts;
    const sponsorWhitelistKey = TokenizedDerivativeCreator.methods.sponsorWhitelist.cacheCall();
    let contractAdded = false;
    let calledIsOnWhitelist = false;
    let onWhitelistKey = null;

    const unsubscribe = drizzle.store.subscribe(() => {
      const drizzleState = drizzle.store.getState();

      const { TokenizedDerivativeCreator } = drizzleState.contracts;
      const sponsorWhitelist = TokenizedDerivativeCreator.sponsorWhitelist[sponsorWhitelistKey];
      if (sponsorWhitelist == null) {
        return;
      }

      const account = this.props.drizzleState.accounts[0];

      const whitelistAddress = sponsorWhitelist.value;
      // Add the sponsorWhitelist contract. Use a flag to prevent recursive calls.
      if (!contractAdded && drizzle.contracts[whitelistAddress] == null) {
        contractAdded = true;
        drizzle.addContract({
          contractName: whitelistAddress,
          web3Contract: new drizzle.web3.eth.Contract(AddressWhitelist.abi, whitelistAddress)
        });
      }

      if (drizzle.contracts[whitelistAddress] == null) {
        return;
      }

      const addressWhitelist = drizzle.contracts[whitelistAddress];
      if (!calledIsOnWhitelist) {
        calledIsOnWhitelist = true;
        onWhitelistKey = addressWhitelist.methods.isOnWhitelist.cacheCall(account);
      }

      const isOnWhitelist = drizzleState.contracts[whitelistAddress].isOnWhitelist[onWhitelistKey];
      if (isOnWhitelist == null) {
        return;
      }

      this.setState({ isCreateDisabled: !isOnWhitelist.value });
      unsubscribe();
    });
  }

  render() {
    const { classes, drizzleState } = this.props;
    const isCreateDisabled = this.state.isCreateDisabled;

    const network = this.props.params.network;
    const titleSubHeader = network !== "main" ? `@${network}` : "";

    return (
      <React.Fragment>
        <CssBaseline />
        <div className="Dashboard">
          <AppBar className={classes.appBar}>
            <Toolbar className={classes.toolbar}>
              <img src="favicon.ico" alt="UMA logo" className={classes.icon} />
              <Typography component="h1" variant="h6" color="inherit" align="left" noWrap className={classes.title}>
                UMA Dashboard {titleSubHeader}
              </Typography>
              <Typography component="h1" variant="h6" color="inherit" align="right" noWrap className={classes.title}>
                {drizzleState.accounts[0]}
              </Typography>
            </Toolbar>
          </AppBar>
          <div className={classes.appBarSpacer} />
          <Dialog
            open={this.state.contractDetailsOpen}
            onClose={this.handleDetailsModalClose}
            className={classes.contractDetailsModal}
            maxWidth="xl"
            aria-labelledby="contract-details"
          >
            <DialogContent>
              <ContractDetails
                contractAddress={this.state.openModalContractAddress}
                drizzle={this.props.drizzle}
                drizzleState={this.props.drizzleState}
                params={this.props.params}
                onClose={this.handleDetailsModalClose}
              />
            </DialogContent>
          </Dialog>
          <CreateContractModal
            params={this.props.params}
            drizzle={this.props.drizzle}
            drizzleState={this.props.drizzleState}
            open={this.state.createContractOpen}
            onClose={this.handleCreateModalClose}
          />
          <Grid container spacing={16} direction="column" alignItems="center" align="center" className={classes.root}>
            <Grid item xs>
              <DerivativeList
                drizzle={this.props.drizzle}
                drizzleState={this.props.drizzleState}
                buttonPushFn={this.handleDetailsModalOpen}
              />
            </Grid>
            <Grid item xs>
              <Button
                variant="contained"
                color="primary"
                disabled={isCreateDisabled}
                onClick={this.handleCreateModalOpen}
                className={classes.createButton}
              >
                Create New Token Contract
              </Button>
            </Grid>
          </Grid>
        </div>
      </React.Fragment>
    );
  }
}

export default withStyles(styles)(Dashboard);
