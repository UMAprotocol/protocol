import React, { useEffect } from "react";
import { drizzleReactHooks } from "drizzle-react";

function useDynamicallyAddedContract(contractAddress, abi) {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const { contract } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    contract: drizzleState.contracts[contractAddress]
  }), [contractAddress]);

  useEffect(() => {
    if (contract) {
      return;
    }
    drizzle.addContract({
      contractName: contractAddress,
      web3Contract: new drizzle.web3.eth.Contract(abi, contractAddress)
    });
  }, [contract, drizzle, abi, contractAddress]);
  return contract;
}

// Higher order component to wrap a given component with smart contract dynamically added to Drizzle.
export const withAddedContract = (abi, extractDerivativeAddressFromPropsFn) => WrappedComponent => {
  return props => {
    const contract = useDynamicallyAddedContract(extractDerivativeAddressFromPropsFn(props), abi);
    if (!contract) {
      return <div>Loading</div>;
    } else {
      return <WrappedComponent {...props} />;
    }
  };
};
