import React from "react";
import { withStyles } from "@material-ui/core/styles";
import AppBar from "@material-ui/core/AppBar";
import Button from "@material-ui/core/Button";
import CssBaseline from "@material-ui/core/CssBaseline";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import Grid from "@material-ui/core/Grid";
import Toolbar from "@material-ui/core/Toolbar";
import Typography from "@material-ui/core/Typography";

import DerivativeList from "./DerivativeList.js";
import ContractDetails from "./ContractDetails.js";
import CreateContractModal from "./CreateContractModal";

const styles = theme => ({
  root: {
    display: "flex",
    width: "100%"
  },
  toolbar: {
    paddingRight: 24 // keep right padding when drawer closed
  },
  appBar: {
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen
    })
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
  }
});

class Dashboard extends React.Component {
  state = { contractDetailsOpen: false, openModalContractAddress: null, createContractOpen: false, userAddress: "0x0" };

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

  render() {
    const { classes } = this.props;
    console.log(this.props);
    return (
      <React.Fragment>
        <CssBaseline />
        <div className="Dashboard">
          <AppBar className={classes.appBar}>
            <Toolbar className={classes.toolbar}>
              <Typography component="h1" variant="h1" color="inherit" align="left" noWrap className={classes.title}>
                UMA Dashboard
              </Typography>
              <Typography component="h1" variant="h1" color="inherit" align="right" noWrap className={classes.title}>
                {this.state.userAddress}
              </Typography>
            </Toolbar>
          </AppBar>
          <div className={classes.appBarSpacer} />
          <Dialog
            open={this.state.contractDetailsOpen}
            onClose={this.handleDetailsModalClose}
            aria-labelledby="contract-details"
          >
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
          <Grid container spacing={16} direction="column" alignItems="center" align="center" className={classes.root}>
            <Grid item xs>
              <DerivativeList
                drizzle={this.props.drizzle}
                drizzleState={this.props.drizzleState}
                buttonPushFn={this.handleDetailsModalOpen}
              />
            </Grid>
            <Grid item xs>
              <Button variant="contained" color="primary" onClick={this.handleCreateModalOpen}>
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
