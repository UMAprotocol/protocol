import React from "react";
import PropTypes from "prop-types";
import classNames from "classnames";
import { withStyles } from "@material-ui/core/styles";
import CssBaseline from "@material-ui/core/CssBaseline";
import Drawer from "@material-ui/core/Drawer";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import List from "@material-ui/core/List";
import Typography from "@material-ui/core/Typography";
import Divider from "@material-ui/core/Divider";
import IconButton from "@material-ui/core/IconButton";
import MenuIcon from "@material-ui/icons/Menu";
import ChevronLeftIcon from "@material-ui/icons/ChevronLeft";
import { mainListItems } from "./listItems";
import SimpleTable from "./SimpleTable";
import DetailTable from "./DetailTable.js";
import Button from "@material-ui/core/Button";
import ArrowBackIcon from "@material-ui/icons/ArrowBack";
import Grid from "@material-ui/core/Grid";
import TextField from "@material-ui/core/TextField";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import InputLabel from "@material-ui/core/InputLabel";
import Paper from "@material-ui/core/Paper";
import Web3 from "web3";
import { default as contract } from "truffle-contract";
import BigNumber from "bignumber.js";

// Import our contract artifacts and turn them into usable abstractions.
import derivative from "./contracts/Derivative.json";
import registry from "./contracts/Registry.json";

const drawerWidth = 300;

const styles = theme => ({
  root: {
    display: "flex"
  },
  toolbar: {
    paddingRight: 24 // keep right padding when drawer closed
  },
  toolbarIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 8px",
    ...theme.mixins.toolbar
  },
  appBar: {
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen
    })
  },
  appBarShift: {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen
    })
  },
  menuButton: {
    marginLeft: 12,
    marginRight: 36
  },
  menuButtonHidden: {
    display: "none"
  },
  title: {
    flexGrow: 1
  },
  paper: {
    marginTop: theme.spacing.unit * 3,
    marginBottom: theme.spacing.unit * 3,
    padding: theme.spacing.unit * 2,
    [theme.breakpoints.up(600 + theme.spacing.unit * 3 * 2)]: {
      marginTop: theme.spacing.unit * 2,
      marginBottom: theme.spacing.unit * 6,
      padding: theme.spacing.unit * 3
    }
  },
  drawerPaper: {
    position: "relative",
    whiteSpace: "nowrap",
    width: drawerWidth,
    transition: theme.transitions.create("width", {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen
    })
  },
  drawerPaperClose: {
    overflowX: "hidden",
    transition: theme.transitions.create("width", {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen
    }),
    width: theme.spacing.unit * 7,
    [theme.breakpoints.up("sm")]: {
      width: theme.spacing.unit * 9
    }
  },
  appBarSpacer: theme.mixins.toolbar,
  content: {
    flexGrow: 1,
    padding: theme.spacing.unit * 3,
    height: "100vh",
    overflow: "auto"
  },
  chartContainer: {
    marginLeft: -22
  },
  tableContainer: {
    height: 320
  }
});

class Dashboard extends React.Component {
  state = {
    open: true,
    page: "list",
    address: "0x0",
    product: "ETH/USD",
    quantity: 1,
    margin: "0.0",
    expiry: "2019-01-01",
    submitButton: false,
    counterparty: "0xf17f52151ebef6c7334fad080c5704d77216b732"
  };

  handleDrawerOpen = () => {
    this.setState({ open: true });
  };

  handleDrawerClose = () => {
    this.setState({ open: false });
  };

  deployContract = async state => {
    var date = new Date(state.expiry);
    date.setHours(17);
    // TODO(mrice32): this is to make up for the UTC offset issue when setting hours - this should be done in a systematic way
    date.setDate(date.getDate() + 1);

    var counterparty = this.state.counterparty;

    var notional = new BigNumber(state.quantity);
    var notionalInWei = BigNumber(this.web3.utils.toWei(notional.toString(), "ether"));
    var marginInEth = notionalInWei.idiv(10);
    var defaultPenaltyInEth = notionalInWei.idiv(20);

    // Default penalty = ~5% of total contract value. Margin ~= 10% of total contract value.
    await this.state.deployedRegistry.createDerivative(
      counterparty,
      defaultPenaltyInEth.toString(),
      marginInEth.toString(),
      (date.valueOf() / 1000).toString(),
      state.product,
      notional.toString(),
      { from: this.state.account, gas: 6654755, value: this.web3.utils.toWei(state.margin) }
    );

    // var response = await this.deployedRegistry.getNumRegisteredContracts({from: this.account});
    this.setState({ page: "list" });
  };

  constructor(props) {
    super(props);

    this.web3 = new Web3(Web3.givenProvider);

    this.derivative = contract(derivative);
    this.registry = contract(registry);

    this.derivative.setProvider(this.web3.currentProvider);
    this.registry.setProvider(this.web3.currentProvider);

    this.web3.eth.getAccounts().then(async (accounts, err) => {
      if (err != null) {
        throw Error("couldn't get accounts");
      }

      if (accounts.length === 0) {
        throw Error("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      }

      this.accounts = accounts;

      this.setState({ account: this.accounts[0] });

      var deployedRegistry = await this.registry.deployed();
      this.setState({ deployedRegistry: deployedRegistry });
      this.setState({ submitButton: true });
    });
  }

  generatePage() {
    const { classes } = this.props;

    var didTapAddress = address => {
      this.setState({ address: address, page: "detailed" });
    };

    if (this.state.page === "list") {
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <Typography variant="display1" gutterBottom component="h2">
            Contracts
          </Typography>
          <div className={classes.tableContainer}>
            <SimpleTable
              didTapAddress={didTapAddress}
              deployedRegistry={this.state.deployedRegistry}
              account={this.state.account}
              derivative={this.derivative}
            />
          </div>
        </main>
      );
    } else if (this.state.page === "detailed") {
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <IconButton
            onClick={() => {
              this.setState({ page: "list" });
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="display1" gutterBottom component="h2">
            Contract Details
          </Typography>
          <div className={classes.tableContainer}>
            <DetailTable
              address={this.state.address}
              derivative={this.derivative}
              account={this.state.account}
              web3={this.web3}
            />
          </div>
        </main>
      );
    } else {
      // Note: this should be moved to another component.
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <React.Fragment>
            <Paper className={classes.paper}>
              <Typography variant="display1" gutterBottom component="h2">
                New Contract
              </Typography>
              <Grid container spacing={24}>
                <Grid item xs={12} sm={6}>
                  <InputLabel htmlFor="product">Product</InputLabel>
                  <Select
                    value={this.state.product}
                    onChange={event => {
                      this.setState({ product: event.target.value });
                    }}
                    inputProps={{
                      name: "product",
                      id: "product"
                    }}
                    fullWidth
                    label="Product"
                  >
                    <MenuItem value={"ETH/USD"}>ETH/USD</MenuItem>
                  </Select>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    id="date"
                    label="Expiry"
                    type="date"
                    fullWidth
                    InputLabelProps={{
                      shrink: true
                    }}
                    value={this.state.expiry}
                    onChange={event => this.setState({ expiry: event.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    id="quantity"
                    name="quantity"
                    label="Notional (ETH)"
                    fullWidth
                    value={this.state.quantity}
                    onChange={event => {
                      if (!isNaN(event.target.value)) {
                        this.setState({ quantity: parseInt(Number(event.target.value), 10) });
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    required
                    id="margin"
                    name="margin"
                    label="Initial Margin Deposit (ETH)"
                    fullWidth
                    value={this.state.margin}
                    onChange={event => {
                      if (!isNaN(event.target.value)) {
                        this.setState({ margin: event.target.value });
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <InputLabel htmlFor="counterparty">Counterparty</InputLabel>
                  <Select
                    value={this.state.counterparty}
                    onChange={event => {
                      this.setState({ counterparty: event.target.value });
                    }}
                    inputProps={{
                      name: "counterparty",
                      id: "counterparty"
                    }}
                    fullWidth
                    label="Counterparty"
                  >
                    <MenuItem value={"0xf17f52151ebef6c7334fad080c5704d77216b732"}>Allison</MenuItem>
                    <MenuItem value={"0xc5fdf4076b8f3a5357c5e395ab970b5b54098fef"}>Chase</MenuItem>
                    <MenuItem value={"0x821aea9a577a9b44299b9c15c88cf3087f3b5544"}>Hart</MenuItem>
                    <MenuItem value={"0x0d1d4e623d10f9fba5db95830f7d3839406c6af2"}>Matt</MenuItem>
                    <MenuItem value={"0x2932b7a2355d6fecc4b5c0b6bd44cc31df247a2e"}>Regina</MenuItem>
                  </Select>
                </Grid>
                <Grid item xs={12}>
                  <Button
                    disabled={!this.state.submitButton}
                    className={classes.button}
                    onClick={() => {
                      this.deployContract(this.state);
                    }}
                    color="primary"
                    fullWidth
                  >
                    Submit
                  </Button>
                </Grid>
              </Grid>
            </Paper>
          </React.Fragment>
        </main>
      );
    }
  }

  render() {
    const { classes } = this.props;

    return (
      <React.Fragment>
        <CssBaseline />
        <div className={classes.root}>
          <AppBar position="absolute" className={classNames(classes.appBar, this.state.open && classes.appBarShift)}>
            <Toolbar disableGutters={!this.state.open} className={classes.toolbar}>
              <IconButton
                color="inherit"
                aria-label="Open drawer"
                onClick={this.handleDrawerOpen}
                className={classNames(classes.menuButton, this.state.open && classes.menuButtonHidden)}
              >
                <MenuIcon />
              </IconButton>
              <Typography component="h1" variant="title" color="inherit" noWrap className={classes.title}>
                Trading Dashboard
              </Typography>
            </Toolbar>
          </AppBar>
          <Drawer
            variant="permanent"
            classes={{
              paper: classNames(classes.drawerPaper, !this.state.open && classes.drawerPaperClose)
            }}
            open={this.state.open}
          >
            <div className={classes.toolbarIcon}>
              <IconButton onClick={this.handleDrawerClose}>
                <ChevronLeftIcon />
              </IconButton>
            </div>
            <Divider />
            <List>{mainListItems(this)}</List>
          </Drawer>
          {this.generatePage()}
        </div>
      </React.Fragment>
    );
  }
}

Dashboard.propTypes = {
  classes: PropTypes.object.isRequired
};

export default withStyles(styles)(Dashboard);
