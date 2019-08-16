import React, { useEffect } from "react";
import { drizzleReactHooks } from "drizzle-react";

function useDynamicallyAddedContract(contractAddress, abi) {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const { contract } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    contract: drizzleState.contracts[contractAddress]
  }));

  useEffect(() => {
    if (contract) {
      return;
    }
    drizzle.addContract({
      contractName: contractAddress,
      web3Contract: new drizzle.web3.eth.Contract(abi, contractAddress)
    });
  });
  return contract;
}

export const withAddedContract = (abi, extractDerivativeAddressFromProps) => WrappedComponent => {
  return props => {
    const contract = useDynamicallyAddedContract(extractDerivativeAddressFromProps(props), abi);
    if (!contract) {
      return <div>Loading</div>;
    } else {
      return <WrappedComponent {...props} />;
    }
  };
};
