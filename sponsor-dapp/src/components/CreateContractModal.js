import React from "react";
import { withStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import CloseIcon from "@material-ui/icons/Close";
import Dialog from "@material-ui/core/Dialog";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import IconButton from "@material-ui/core/IconButton";
import InputLabel from "@material-ui/core/InputLabel";
import FormControl from "@material-ui/core/FormControl";
import FormHelperText from "@material-ui/core/FormHelperText";
import MenuItem from "@material-ui/core/MenuItem";
import ReactGA from "react-ga";
import Select from "@material-ui/core/Select";
import TextField from "@material-ui/core/TextField";
import Typography from "@material-ui/core/Typography";

import DrizzleHelper from "../utils/DrizzleHelper.js";
import { currencyAddressToName } from "../utils/ParameterLookupUtils.js";

import AddressWhitelist from "../contracts/AddressWhitelist";
import LeveragedReturnCalculator from "../contracts/LeveragedReturnCalculator";

const styles = theme => ({
  root: {
    display: "flex",
    flexDirection: "column",
    marginTop: "30px"
  },
  submitButton: {
    marginTop: "30px"
  },
  title: {
    margin: 0,
    padding: theme.spacing.unit * 2
  },
  modal: {
    width: "652px"
  },
  closeButton: {
    position: "absolute",
    right: theme.spacing.unit,
    top: theme.spacing.unit,
    color: theme.palette.grey[500]
  }
});

class CreateContractModal extends React.Component {
  state = {
    returnCalculatorAddresses: [],
    returnCalculatorLeverage: [],
    approvedIdentifiers: [],

    loadingMarginCurrency: true,

    // Current value in the form.
    formInputs: {
      leverage: "",
      identifier: "",
      name: "",
      symbol: "",
      margin: ""
    },

    // Any error text in the form.
    marginFormError: ""
  };

  componentDidMount() {
    this.drizzleHelper = new DrizzleHelper(this.props.drizzle);
    this.verifyPriceFeeds();
    this.addReturnCalculatorWhitelist();
    this.getReturnCalculatorAddresses();
    this.addReturnCalculators();
    this.getLeverage();

    this.getMarginCurrency().catch(error => {
      console.error(`Failed to get margin currency: {error}`);
    });
  }

  submit = () => {
    const { drizzle, drizzleState, onClose, params } = this.props;
    const { web3 } = drizzle;
    const { formInputs } = this.state;
    const account = drizzleState.accounts[0];

    // 10^18 * 10^18, which represents 10^20%. This is large enough to never hit, but small enough that the numbers
    // will never overflow when multiplying by a balance.
    const withdrawLimit = "1000000000000000000000000000000000000";

    let assetPrice = web3.utils.toWei("1", "ether");
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(formInputs.identifier));

    // Should always be the case, but the above value is a fallback.
    if (this.drizzleHelper.hasCache("ManualPriceFeed", "latestPrice", [identifierBytes])) {
      assetPrice = this.drizzleHelper.getCache("ManualPriceFeed", "latestPrice", [identifierBytes]).price.toString();
    }

    const constructorParams = {
      sponsor: account,
      defaultPenalty: web3.utils.toWei("1", "ether"),
      supportedMove: web3.utils.toWei(params.identifiers[formInputs.identifier].supportedMove, "ether"),
      product: identifierBytes,
      fixedYearlyFee: "0", // Must be 0 for linear return type.
      disputeDeposit: web3.utils.toWei("1", "ether"),
      returnCalculator: formInputs.leverage,
      startingTokenPrice: assetPrice, // Align the starting asset price and the starting token price.
      expiry: params.identifiers[formInputs.identifier].expiry,
      marginCurrency: formInputs.margin,
      withdrawLimit: withdrawLimit,
      returnType: "0", // Linear
      startingUnderlyingPrice: assetPrice, // Use price feed.
      name: formInputs.name,
      symbol: formInputs.symbol
    };

    const { TokenizedDerivativeCreator } = drizzle.contracts;
    TokenizedDerivativeCreator.methods.createTokenizedDerivative.cacheSend(constructorParams, { from: account });

    // TODO: Add error handling and delay closing the modal until there's confirmation
    // that the transaction has been included in the blockchain.
    onClose();
  };

  async getMarginCurrency() {
    const { result: whitelistAddress } = await this.drizzleHelper.cacheCall(
      "TokenizedDerivativeCreator",
      "marginCurrencyWhitelist",
      []
    );
    await this.drizzleHelper.addContract(whitelistAddress, AddressWhitelist.abi);
    const { result: marginWhitelist } = await this.drizzleHelper.cacheCall(whitelistAddress, "getWhitelist", []);

    if (!marginWhitelist.length) {
      this.setState({
        loadingMarginCurrency: false,
        marginFormError: "Margin currency not found"
      });
      return;
    }

    this.setState({
      loadingMarginCurrency: false
    });

    // Set as default if only one margin currency exists.
    if (marginWhitelist.length === 1) {
      this.updateFormInput("margin", marginWhitelist[0]);
    }
  }

  // Sets this.state.approvedIdentifiers to be a list of strings representing the approved identifers that are also
  // configured in this.props.params, e.g., ["SPY/USD", "BTC/ETH"].
  verifyPriceFeeds() {
    const { drizzle, params } = this.props;
    const { ManualPriceFeed } = drizzle.contracts;
    const { web3 } = drizzle;

    const identifierDataKeys = {};
    Object.keys(params.identifiers).forEach(identifier => {
      const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
      // Calling latestPrice() on an unsupported identifier will revert, leading to errors being printed in the console.
      // We don't expect any identifiers in params.identifiers to actually be unsupported, so it's not worth doing
      // these calls sequentially.
      identifierDataKeys[identifier] = {
        supported: ManualPriceFeed.methods.isIdentifierSupported.cacheCall(identifierBytes),
        price: ManualPriceFeed.methods.latestPrice.cacheCall(identifierBytes)
      };
    });

    const unsubscribe = drizzle.store.subscribe(() => {
      const drizzleState = this.props.drizzleState;

      const { ManualPriceFeed } = drizzleState.contracts;

      const callFinished = Object.values(identifierDataKeys).every(dataKeys => {
        return ManualPriceFeed.isIdentifierSupported[dataKeys.supported] && ManualPriceFeed.latestPrice[dataKeys.price];
      });
      if (!callFinished) {
        return;
      }

      const approvedIdentifiers = Object.keys(identifierDataKeys).filter(identifier => {
        return ManualPriceFeed.isIdentifierSupported[identifierDataKeys[identifier].supported].value;
      });

      this.setState({ approvedIdentifiers });

      // Set as default if only one identifier exists.
      if (approvedIdentifiers.length === 1) {
        this.updateFormInput("identifier", approvedIdentifiers[0]);
      }
      unsubscribe();
    });
  }

  addReturnCalculatorWhitelist() {
    const { drizzle } = this.props;

    const { TokenizedDerivativeCreator } = drizzle.contracts;
    const returnCalculatorKey = TokenizedDerivativeCreator.methods.returnCalculatorWhitelist.cacheCall();

    const unsubscribe = drizzle.store.subscribe(() => {
      const drizzleState = this.props.drizzleState;

      const { TokenizedDerivativeCreator } = drizzleState.contracts;
      const cachedAddress = TokenizedDerivativeCreator.returnCalculatorWhitelist[returnCalculatorKey];
      if (!cachedAddress) {
        return;
      }

      this.whitelistAddress = cachedAddress.value;

      unsubscribe();
      drizzle.addContract({
        contractName: this.whitelistAddress,
        web3Contract: new drizzle.web3.eth.Contract(AddressWhitelist.abi, this.whitelistAddress)
      });
    });
  }

  getReturnCalculatorAddresses() {
    const { drizzle } = this.props;

    let callGetWhitelist = false;
    let returnCalculatorWhitelistKey;

    const unsubscribe = drizzle.store.subscribe(() => {
      const drizzleState = this.props.drizzleState;
      if (!this.whitelistAddress) {
        return;
      }

      const addressWhitelist = drizzle.contracts[this.whitelistAddress];
      if (!addressWhitelist) {
        return;
      }

      if (!callGetWhitelist) {
        callGetWhitelist = true;
        returnCalculatorWhitelistKey = addressWhitelist.methods.getWhitelist.cacheCall();
      }

      const whitelistState = drizzleState.contracts[this.whitelistAddress];
      if (!whitelistState) {
        return;
      }

      const cacheWhitelist = whitelistState.getWhitelist[returnCalculatorWhitelistKey];
      if (!cacheWhitelist) {
        return;
      }

      this.setState({ returnCalculatorAddresses: cacheWhitelist.value });
      unsubscribe();
    });
  }

  addReturnCalculators() {
    const { drizzle } = this.props;

    const unsubscribe = drizzle.store.subscribe(() => {
      if (!this.state.returnCalculatorAddresses.length) {
        return;
      }

      unsubscribe();
      this.state.returnCalculatorAddresses.forEach(address => {
        drizzle.addContract({
          contractName: address,
          web3Contract: new drizzle.web3.eth.Contract(LeveragedReturnCalculator.abi, address)
        });
      });
    });
  }

  // NOTE: This function fetches the leverage value for LeveragedReturnCalculator
  // but does not automatically update if the value changes. This is fine in the specific
  // business case, where the value is not expected to change but does not conform to
  // drizzle's design philosophy.
  getLeverage() {
    const { drizzle } = this.props;

    let leverageCalled = false;

    // Stores the argument hash for each LeveragedReturnCalculator.leverage cacheCall.
    const leverageKeys = [];

    const unsubscribe = drizzle.store.subscribe(() => {
      const drizzleState = this.props.drizzleState;

      if (!this.state.returnCalculatorAddresses.length) {
        return;
      }

      const contractsLoaded = this.state.returnCalculatorAddresses.every(address => {
        return drizzle.contracts[address];
      });

      if (!contractsLoaded) {
        return;
      }

      if (!leverageCalled) {
        leverageCalled = true;
        this.state.returnCalculatorAddresses.forEach(address => {
          leverageKeys.push(drizzle.contracts[address].methods.leverage.cacheCall());
        });
      }

      const leverageLoaded = this.state.returnCalculatorAddresses.every((address, idx) => {
        const key = leverageKeys[idx];
        return drizzleState.contracts[address].leverage[key];
      });

      if (!leverageLoaded) {
        return false;
      }

      const leverage = this.state.returnCalculatorAddresses.map((address, idx) => {
        const key = leverageKeys[idx];
        return drizzleState.contracts[address].leverage[key].value;
      });

      this.setState({ returnCalculatorLeverage: leverage });

      // Set as default if only one exists.
      if (leverage.length === 1) {
        this.updateFormInput("leverage", this.state.returnCalculatorAddresses[0]);
      }

      unsubscribe();
    });
  }

  updateFormInput = (key, value) => {
    this.setState((state, props) => ({ formInputs: { ...state.formInputs, [key]: value } }));
  };

  handleChange = name => event => {
    this.updateFormInput(name, event.target.value);
  };

  onEntered = () => {
    if (process.env.NODE_ENV === "production") {
      ReactGA.modalview("/createcontract");
    }
  };

  // Create Material-UI menu items where both the value attribute and display value are the same.
  createMenuItems = list => {
    return list.map(item => (
      <MenuItem value={item} key={item}>
        {item}
      </MenuItem>
    ));
  };

  marginErrorElement() {
    if (this.state.marginFormError) {
      return <FormHelperText id="create-contract-margin-text">{this.state.marginFormError}</FormHelperText>;
    }

    return;
  }

  render() {
    const { classes, drizzleState, params } = this.props;
    const account = drizzleState.accounts[0];

    const leverageMenuItems = this.state.returnCalculatorAddresses.map((address, idx) => (
      <MenuItem value={address} key={address}>
        {this.state.returnCalculatorLeverage[idx]}
      </MenuItem>
    ));

    const identifierMenuItems = this.createMenuItems(this.state.approvedIdentifiers);

    const marginErrorElement = this.marginErrorElement();

    let marginWhitelist = [];
    if (!this.state.loadingMarginCurrency) {
      const whitelistAddress = this.drizzleHelper.getCache("TokenizedDerivativeCreator", "marginCurrencyWhitelist", []);
      marginWhitelist = this.drizzleHelper.getCache(whitelistAddress, "getWhitelist", []);
    }

    const marginCurrencyMenuItems = marginWhitelist.map(address => (
      <MenuItem value={address} key={address}>
        {currencyAddressToName(params, address) || address}
      </MenuItem>
    ));

    return (
      <Dialog
        open={this.props.open}
        onClose={this.props.onClose}
        onEntered={this.onEntered}
        classes={{ paper: classes.modal }}
      >
        <DialogTitle className={classes.title}>
          Create New Token Contract
          <IconButton onClick={this.props.onClose} className={classes.closeButton}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <div>
            <Typography variant="body2">Account: {account}</Typography>
          </div>
          <form className={classes.root} autoComplete="off">
            <FormControl>
              <InputLabel htmlFor="create-contract-leverage">Leverage</InputLabel>
              <Select
                value={this.state.formInputs.leverage}
                onChange={this.handleChange("leverage")}
                inputProps={{
                  name: "leverage",
                  id: "create-contract-leverage"
                }}
              >
                {leverageMenuItems}
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel htmlFor="create-contract-asset">Asset Type</InputLabel>
              <Select
                value={this.state.formInputs.identifier}
                onChange={this.handleChange("identifier")}
                inputProps={{
                  name: "identifier",
                  id: "create-contract-asset"
                }}
              >
                {identifierMenuItems}
              </Select>
            </FormControl>
            <FormControl error={this.state.marginFormError !== ""}>
              <InputLabel htmlFor="create-contract-margin">Margin Currency</InputLabel>
              <Select
                value={this.state.formInputs.margin}
                onChange={this.handleChange("margin")}
                inputProps={{
                  name: "margin",
                  id: "create-contract-margin"
                }}
              >
                {marginCurrencyMenuItems}
              </Select>
              {marginErrorElement}
            </FormControl>
            <TextField
              id="contract-name"
              label="Contract Name"
              value={this.state.formInputs.name}
              onChange={this.handleChange("name")}
            />
            <TextField
              id="contract-symbol"
              label="Contract Symbol"
              value={this.state.formInputs.symbol}
              onChange={this.handleChange("symbol")}
            />
          </form>
          <Button
            disabled={this.state.loadingMarginCurrency}
            variant="contained"
            color="primary"
            className={classes.submitButton}
            onClick={this.submit}
          >
            Create Contract
          </Button>
        </DialogContent>
      </Dialog>
    );
  }
}

export default withStyles(styles)(CreateContractModal);
