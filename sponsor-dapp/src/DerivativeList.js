import React from "react";

class DerivativeList extends React.Component {
  state = { dataKey: null };

  componentDidMount() {
    const { Registry } = this.props.drizzle.contracts;

    // Get and save the key for the variable we are interested in.
    const dataKey = Registry.methods.getAllRegisteredDerivatives.cacheCall();
    this.setState({ dataKey });
  }

  render() {
    const { Registry } = this.props.drizzleState.contracts;

    // If the cache key we received earlier isn't in the store yet; the initial value is still being fetched.
    if (!(this.state.dataKey in Registry.getAllRegisteredDerivatives)) {
      return <span>Fetching...</span>;
    }

    // Get the number of contracts currently in the registry.
    let numContracts = Registry.getAllRegisteredDerivatives[this.state.dataKey].value.length;

    // If the contract is in the process of syncing, provide the user with an indicator.
    let syncingIndicator = Registry.synced ? "" : " (still syncing)";

    return (
      <span>
        {numContracts} elements currently in Registry{syncingIndicator}.
      </span>
    );
  }
}

export default DerivativeList;
