import React from "react";
import DerivativeListTable from "./DerivativeListTable.js";
import TokenizedDerivative from "../contracts/TokenizedDerivative.json";
import { stateToString } from "../utils/TokenizedDerivativeUtils.js";
import { formatDate } from "../utils/FormattingUtils.js";

class DerivativeList extends React.Component {
  state = { registryDataKey: null, derivativeKeyMap: {} };
  unsubscribeFromStore = null;
  subscriptionLock = false;

  componentDidMount() {
    const { drizzle } = this.props;
    const { Registry } = drizzle.contracts;

    // Start the drizzle subscription that listens for new derivatives.
    this.subscribe();

    // Get the key for all registered derivatives involving this account.
    const registryDataKey = Registry.methods.getAllRegisteredDerivatives.cacheCall();

    this.setState({ registryDataKey });
  }

  getDerivativeList() {
    const { Registry } = this.props.drizzleState.contracts;

    if (!(this.state.registryDataKey in Registry.getAllRegisteredDerivatives)) {
      return [];
    }

    // Null is returned if the registry has no derivatives, so we need to specifically handle this case to turn it into
    // an empty array.
    if (Registry.getAllRegisteredDerivatives[this.state.registryDataKey].value == null) {
      return [];
    }

    return Registry.getAllRegisteredDerivatives[this.state.registryDataKey].value;
  }

  isObjectEmpty(obj) {
    return Object.entries(obj).length === 0 && obj.constructor === Object;
  }

  // Subscription methods.
  subscribe() {
    const { drizzle } = this.props;
    if (this.unsubscribeFromStore == null) {
      this.unsubscribeFromStore = drizzle.store.subscribe(() => {
        this.waitForNewDerivatives();
      });
    }
  }

  unsubscribe() {
    if (this.unsubscribeFromStore != null) {
      this.unsubscribeFromStore();
      this.unsubscribeFromStore = null;
    }
  }

  // Method that is run every time drizzle updates.
  waitForNewDerivatives() {
    // The subscription lock prevents calls inside of this method from triggering a reentry into the method.
    if (this.subscriptionLock) {
      return;
    }
    this.subscriptionLock = true;

    const { drizzle, drizzleState } = this.props;
    const { web3 } = drizzle;
    const derivatives = this.getDerivativeList();

    let additionalDerivativeKeys = {};
    for (let derivative of derivatives) {
      // Use the checksum address as the key since it's the canonical representation of ETH addresses.
      const derivativeChecksumAddress = web3.utils.toChecksumAddress(derivative.derivativeAddress);

      if (!(derivativeChecksumAddress in drizzle.contracts)) {
        // If the contract is not present in the drizzle tracked contracts, add it.
        // Note: this doesn't happen instantaneously, so contracts may be added multiple times.
        // TODO(mrice32): add a state variable to track this instead of relying on drizzle to prevent duplicate adds.
        const contractConfig = {
          contractName: derivativeChecksumAddress,
          web3Contract: new web3.eth.Contract(TokenizedDerivative.abi, derivativeChecksumAddress)
        };
        drizzle.addContract(contractConfig);
      } else if (!(derivativeChecksumAddress in this.state.derivativeKeyMap)) {
        // If the contract is in drizzle, but its keys haven't been added to the derivativeKeyMap, we need to add them
        // before they can be used.
        const derivativeContractMethods = drizzle.contracts[derivativeChecksumAddress].methods;

        additionalDerivativeKeys[derivativeChecksumAddress] = {
          tokenNameKey: derivativeContractMethods.name.cacheCall(),
          symbolKey: derivativeContractMethods.symbol.cacheCall(),
          tokensHeldKey: derivativeContractMethods.balanceOf.cacheCall(drizzleState.accounts[0]),
          derivativeStorageKey: derivativeContractMethods.derivativeStorage.cacheCall()
        };
      }
    }

    // additionalDerivativeKeys tracks new keys that need to be added to the state. If there are keys in this map,
    // append them to the state.
    if (!this.isObjectEmpty(additionalDerivativeKeys)) {
      this.setState((state, props) => {
        return { ...state, derivativeKeyMap: { ...state.derivativeKeyMap, ...additionalDerivativeKeys } };
      });
    }

    // Unlock the subscription lock.
    this.subscriptionLock = false;
  }

  getDerivativesData() {
    const { drizzle, drizzleState } = this.props;
    const { web3 } = drizzle;

    // Get the contracts currently in the registry.
    const derivatives = this.getDerivativeList();

    // Array for data that should be passed to the table.
    let derivativesData = [];
    let i = 1;
    for (let derivative of derivatives) {
      const derivativeChecksumAddress = web3.utils.toChecksumAddress(derivative.derivativeAddress);

      // If the derivative is not in the derivativeKeyMap, none of its information can be retrieved.
      if (!(derivativeChecksumAddress in this.state.derivativeKeyMap)) {
        continue;
      }

      // Get the keys and the contract state.
      const { tokenNameKey, symbolKey, tokensHeldKey, derivativeStorageKey } = this.state.derivativeKeyMap[
        derivativeChecksumAddress
      ];
      const contract = drizzleState.contracts[derivativeChecksumAddress];

      // Determine if drizzle has loaded all the data we need and skip if not.
      const allDataInDrizzle =
        tokenNameKey in contract.name &&
        symbolKey in contract.symbol &&
        tokensHeldKey in contract.balanceOf &&
        derivativeStorageKey in contract.derivativeStorage;
      if (!allDataInDrizzle) {
        continue;
      }

      const derivativeStorage = contract.derivativeStorage[derivativeStorageKey].value;

      // Determine the user's role (will always be sponsor for now).
      let role;
      if (
        web3.utils.toChecksumAddress(drizzleState.accounts[0]) ===
        web3.utils.toChecksumAddress(derivativeStorage.externalAddresses.sponsor)
      ) {
        role = "Sponsor";
      } else if (contract.balanceOf[tokensHeldKey].value.toString() !== "0") {
        role = "Token Holder";
      } else if (process.env.REACT_APP_MODE === "monitoring") {
        // Show watcher for all other contract if the dapp is in the monitoring mode.
        role = "Watcher";
      } else {
        // Don't show this contract if the user isn't involved and the mode doesn't permit users to see all contracts.
        continue;
      }

      // Add the data from drizzle to the array.
      derivativesData.push({
        address: derivativeChecksumAddress,
        tokenName: contract.name[tokenNameKey].value,
        symbol: contract.symbol[symbolKey].value,
        status: stateToString(derivativeStorage.state.toString()),
        asset: web3.utils.toAscii(derivativeStorage.fixedParameters.product),
        created: formatDate(derivativeStorage.fixedParameters.creationTime, web3),
        role: role,
        id: i++
      });
    }

    return derivativesData;
  }

  // Ensure the drizzle subscription is canceled when the component unmounts.
  componentWillUnmount() {
    this.unsubscribe();
  }

  render() {
    const derivatives = this.getDerivativesData();

    return <DerivativeListTable derivatives={derivatives} buttonPushFn={this.props.buttonPushFn} />;
  }
}

export default DerivativeList;
