import React from "react";
import DerivativeListTable from "./DerivativeListTable.js";

class DerivativeList extends React.Component {
  state = { dataKey: null };

  componentDidMount() {
    const { Registry } = this.props.drizzle.contracts;

    // Get and save the key for the variable we are interested in.
    const dataKey = Registry.methods.getAllRegisteredDerivatives.cacheCall();
    this.setState({ dataKey });
  }

  getDerivativeType(creatorAddress) {
    const { TokenizedDerivativeCreator } = this.props.drizzle.contracts;
    const { web3 } = this.props.drizzle;

    // Get address checksum.
    const creatorAddressChecksum = web3.utils.toChecksumAddress(creatorAddress);

    // Compare checksum against known creators.
    if (creatorAddressChecksum === web3.utils.toChecksumAddress(TokenizedDerivativeCreator.address)) {
      return "TokenizedDerivative";
    } else {
      return "Unknown";
    }
  }

  getDerivativesData() {
    const { Registry, TokenizedDerivativeCreator } = this.props.drizzleState.contracts;

    const dummyDerivative = { derivativeAddress: "0x0", derivativeCreator: TokenizedDerivativeCreator.address };

    // Get the contracts currently in the registry.
    const derivatives = [dummyDerivative, ...Registry.getAllRegisteredDerivatives[this.state.dataKey].value];

    let derivativesData = [];
    for (let i = 0; i < derivatives.length; i++) {
      const derivative = derivatives[i];
      derivativesData.push({
        type: this.getDerivativeType(derivative.derivativeCreator),
        address: derivative.derivativeAddress,
        tokenName: "Oil/Dai Coin",
        symbol: "OILD",
        status: "Active",
        asset: "Oil/Dai",
        created: "Tuesday, 05-Feb-19 16:43:01 UTC",
        role: "Creator",
        id: i + 1
      });
    }
    return derivativesData;
  }

  render() {
    const { Registry } = this.props.drizzleState.contracts;

    // If the cache key we received earlier isn't in the store yet; the initial value is still being fetched.
    if (!(this.state.dataKey in Registry.getAllRegisteredDerivatives)) {
      return <span>Fetching...</span>;
    }

    const derivatives = this.getDerivativesData();

    return <DerivativeListTable derivatives={derivatives} buttonPushFn={this.props.buttonPushFn} />;
  }
}

export default DerivativeList;
