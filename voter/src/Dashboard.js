import React from "react";
import PropTypes from "prop-types";
import classNames from "classnames";
import { withStyles } from "@material-ui/core/styles";
import CssBaseline from "@material-ui/core/CssBaseline";
import AppBar from "@material-ui/core/AppBar";
import Toolbar from "@material-ui/core/Toolbar";
import Typography from "@material-ui/core/Typography";
import IconButton from "@material-ui/core/IconButton";
import MenuIcon from "@material-ui/icons/Menu";
import Button from "@material-ui/core/Button";
import Grid from "@material-ui/core/Grid";
import TextField from "@material-ui/core/TextField";
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import InputLabel from "@material-ui/core/InputLabel";
import Paper from "@material-ui/core/Paper";
import Web3 from "web3";
import { default as contract } from "truffle-contract";
import BigNumber from "bignumber.js";
import SimpleLineChart from "./SimpleLineChart";

// Import our contract artifacts and turn them into usable abstractions.
import vote from "./contracts/VoteCoin.json";
import derivative from "./contracts/Derivative.json";
import registry from "./contracts/Registry.json";

const drawerWidth = 300;


function getNewWeb3(existingWeb3) {
    var Web3 = require('web3');
    return new Web3(existingWeb3.currentProvider);
}

function convertContractToNewWeb3(newWeb3, existingContract) {
    return new newWeb3.eth.Contract(existingContract.abi, existingContract.address);
}

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
    page: "plot",
    address: "0x0",
    product: "ETH/USD",
    quantity: 1,
    margin: "0.0",
    expiry: "2019-01-01",
    submitButton: false,
    data: [],
    proposalHashes: [],
    hashIndex: 0,
    period: "wait",
    secret: ""
  };

  handleDrawerOpen = () => {
    this.setState({ open: true });
  };

  handleDrawerClose = () => {
    this.setState({ open: false });
  };

  update = async vote => {
    var period = await this.getPeriod(vote);
    if (period === "primary_commit" || period === "primary_reveal") {
      var prices = await vote.methods.getDefaultProposalPrices().call();
      var data = [];
      for (var i = 0; i < prices.length; ++i) {
        var date = new Date(prices[i][1] * 1000)
        date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
        data.push({time: date.toDateString(), Price: this.web3.utils.fromWei(prices[i][0].toString())});
      }

      this.setState({ data: data, period: period });
    } else if (period === "runoff_commit" || period === "runoff_reveal") {
      // Grab proposal hashes
      var proposals = await vote.methods.getProposals().call();
      var proposalHashes = [];
      for (var i = 0; i < proposals.length; ++i) {
        proposalHashes.push({id: i, hash: proposals[i][1]});
      }
      this.setState({ proposalHashes: proposalHashes, period: period })
    } else {
      this.setState({ period: period })
    }
  }

  submitVote = async choice => {
    if (this.state.period === "primary_commit" || this.state.period === "runoff_commit") {
      var hashValue = await this.state.deployedVote.methods.computeHash(choice.toString(), this.state.secret.toString()).call();
      await this.state.deployedVote.methods.commitVote(hashValue).send({ from: this.state.account, gas: 6720000 });
    } else if (this.state.period === "primary_reveal" || this.state.period === "runoff_reveal") {
      await this.state.deployedVote.methods.revealVote(choice.toString(), this.state.secret.toString()).send({from: this.state.account, gas: 6720000 });
    }
  }

  getPeriod = async vote => {
    var currentPeriod = await vote.methods.getCurrentPeriodType().call();

    var periodName;
    switch (currentPeriod) {
      case "commit":
        periodName = "primary_commit";
        break;
      case "reveal":
        periodName = "primary_reveal";
        break;
      case "runoff commit":
        periodName = "runoff_commit";
        break;
      case "runoff reveal":
        periodName = "runoff_reveal";
        break;
      case "wait":
        periodName = "wait";
        break;
      default:
        periodName = this.state.period;
    }

    return periodName;
  }

  generateHashes = () => {
    return (
      <Select
        value={this.state.hashIndex}
        onChange={event => {
          console.log(event.target.value);
          this.setState({ hashIndex: event.target.value });
        }}
        inputProps={{
          name: "hash",
          id: "hash"
        }}
        fullWidth
        label="IPFS Hash"
      >
        {this.state.proposalHashes.map(n => {
          return <MenuItem key={n.id} value={n.id}>{n.hash}</MenuItem>;
        })}
      </Select>
    );
  }

  generateVoteButton = (label, voteInput) => {
    const { classes } = this.props; 
    return (
      <Button
        className={classes.button}
        onClick={() => {
          this.submitVote(voteInput());
        }}
        color="primary"
        fullWidth
      >
        {label}
      </Button>
    );

  }

  generateSecret = () => {
    return (
      <TextField
        required
        id="secret"
        name="secret"
        label="Secret"
        fullWidth
        value={this.state.secret}
        onChange={event => {
          if (!isNaN(event.target.value)) {
            this.setState({ secret: event.target.value });
          }
        }}
      />
    );
  }

  constructor(props) {
    super(props);


    this.web3 = new Web3(Web3.givenProvider);

    this.vote = contract(vote)
    this.derivative = contract(derivative);
    this.registry = contract(registry);

    this.vote.setProvider(this.web3.currentProvider);
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

      var deployedRegistry = convertContractToNewWeb3(this.web3, await this.registry.deployed());
      var deployedVote = convertContractToNewWeb3(this.web3, await this.vote.deployed());
      this.setState({ deployedRegistry: deployedRegistry, deployedVote: deployedVote });
      await this.update(deployedVote);
    });
  }

  generatePage() {
    const { classes } = this.props;

    var didTapAddress = address => {
      this.setState({ address: address, page: "detailed" });
    };

    if (this.state.period === "primary_commit" || this.state.period === "primary_reveal") {
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <Typography variant="h4" gutterBottom component="h2">
              ETH/USD Price
            </Typography>
            <Typography component="div" className={classes.chartContainer}>
              <SimpleLineChart data={this.state.data} />
            </Typography>
            <Paper className={classes.paper}>
              <Typography variant="display1" gutterBottom component="h2">
                {this.state.period === "primary_commit" ? "Commit Vote" : "Reveal Vote"}
              </Typography>
              <Grid container spacing={24}>
                <Grid item xs={12}>
                  {this.generateSecret()}
                </Grid>
                <Grid item xs={12} sm={6}>
                  {this.generateVoteButton(this.state.period === "primary_commit" ? "Commit Dispute" : "Reveal Dispute", () => { return 0; })}
                </Grid>
                <Grid item xs={12} sm={6}>
                  {this.generateVoteButton(this.state.period === "primary_commit" ? "Commit Verification" : "Reveal Verification", () => { return 1; })}
                </Grid>
              </Grid>
            </Paper>
        </main>
      );
    } else if (this.state.period === "runoff_commit" || this.state.period === "runoff_reveal") {
      return (
         <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <React.Fragment>
            <Paper className={classes.paper}>
              <Typography variant="display1" gutterBottom component="h2">
                {this.state.period === "runoff_commit" ? "Commit Vote" : "Reveal Vote"}
              </Typography>
              <Grid container spacing={24}>
                <Grid item xs={12}>
                  <InputLabel htmlFor="hash">IPFS Hash</InputLabel>
                  {this.generateHashes()}
                </Grid>
                <Grid item xs={12} sm={6}>
                  {this.generateSecret()}
                </Grid>
                <Grid item xs={12} sm={6}>
                  {this.generateVoteButton(this.state.period === "runoff_commit" ? "Commit Choice" : "Reveal Choice", () => { return this.state.hashIndex; })}
                </Grid>
              </Grid>
            </Paper>
          </React.Fragment>
        </main>
      );
    } else {
      return (
        <main className={classes.content}>
          <div className={classes.appBarSpacer} />
          <Typography variant="h4" gutterBottom component="h2">
              ETH/USD Price
            </Typography>
            <Typography component="div" className={classes.chartContainer}>
              <SimpleLineChart data={this.state.data} />
            </Typography>
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
          <AppBar position="absolute" className={classNames(classes.appBar, false && classes.appBarShift)}>
            <Toolbar disableGutters={false} className={classes.toolbar}>
              <IconButton
                color="inherit"
                aria-label="Open drawer"
                onClick={this.handleDrawerOpen}
                className={classNames(classes.menuButton, this.state.open && classes.menuButtonHidden)}
              >
                <MenuIcon />
              </IconButton>
              <Typography component="h1" variant="title" color="inherit" noWrap className={classes.title}>
                Voting Dashboard
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
