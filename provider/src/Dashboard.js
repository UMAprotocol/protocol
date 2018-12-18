import React from "react";
import PropTypes from "prop-types";
import { withStyles } from "@material-ui/core/styles";
import CssBaseline from "@material-ui/core/CssBaseline";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import Grid from "@material-ui/core/Grid";
import Web3 from "web3";
import { default as contract } from "truffle-contract";
import SimpleTable from "./SimpleTable";
import ContractDetails from "./ContractDetails";
import Divider from "@material-ui/core/Divider";

// Import our contract artifacts and turn them into usable abstractions.
import Oracle from "./contracts/OracleMock.json";
import TokenizedDerivative from "./contracts/TokenizedDerivative.json";

const drawerWidth = 300;
const tokenizedDerivativeAddress = "0xE1d5Aef716F3a59EFC168A057C9f4F8052adf2d0";

const styles = theme => ({
  root: {
    display: "flex",
    width: "100%"
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
    height: "flex"
  }
});

class Dashboard extends React.Component {
  state = {
    open: true,
    page: "plot"
  };

  constructor(props) {
    super(props);

    this.web3 = new Web3(Web3.givenProvider);

    this.oracleContract = contract(Oracle);
    this.tokenizedDerivativeContract = contract(TokenizedDerivative);

    this.oracleContract.setProvider(this.web3.currentProvider);
    this.tokenizedDerivativeContract.setProvider(this.web3.currentProvider);

    this.web3.eth.getAccounts().then(async (accounts, err) => {
      if (err != null) {
        throw Error("couldn't get accounts");
      }

      if (accounts.length === 0) {
        throw Error("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      }

      this.accounts = accounts;

      this.setState({ account: this.accounts[0] });

      var oracle = await this.oracleContract.deployed();
      var tokenizedDerivative = await this.tokenizedDerivativeContract.at(tokenizedDerivativeAddress);
      this.setState({ tokenizedDerivative: tokenizedDerivative, oracle: oracle });
    });
  }

  generatePage() {
    const { classes } = this.props;

    if (this.state.tokenizedDerivative && this.state.oracle) {
      var doRemargin = async () => {
        await this.state.tokenizedDerivative.remargin({ from: this.state.account });
        this.setState({});
      };
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <Grid container spacing={16} direction="column" alignItems="center" align="center" className={classes.root}>
            <Grid item xs>
              <Typography align="center" variant="h5" gutterBottom color="textSecondary" component="h5">
                Contract Details
              </Typography>
            </Grid>
            <Grid item xs>
              <ContractDetails
                tokenizedDerivative={this.state.tokenizedDerivative}
                oracle={this.state.oracle}
                web3={this.web3}
              />
            </Grid>
            <Grid item xs>
              <Divider />
            </Grid>
            <Grid item xs align="center">
              <Typography align="center" variant="h5" gutterBottom color="textSecondary" component="h5">
                Current Contract State
              </Typography>
            </Grid>
            <Grid item xs>
              <div className={classes.tableContainer}>
                <SimpleTable
                  tokenizedDerivative={this.state.tokenizedDerivative}
                  oracle={this.state.oracle}
                  web3={this.web3}
                />
              </div>
            </Grid>
            <Grid item xs>
              <Button variant="contained" color="primary" onClick={doRemargin} size="large" fullWidth={true}>
                Recompute Value
              </Button>
            </Grid>
          </Grid>
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
          <AppBar className={classes.appBar}>
            <Toolbar className={classes.toolbar}>
              <Typography
                component="h1"
                variant="title"
                color="inherit"
                align="center"
                noWrap
                className={classes.title}
              >
                UMA 2XBCE Token
              </Typography>
            </Toolbar>
          </AppBar>
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
