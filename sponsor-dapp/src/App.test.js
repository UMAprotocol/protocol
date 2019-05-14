import React from "react";
import ReactDOM from "react-dom";
import { Drizzle, generateStore } from "drizzle";
import { DrizzleContext } from "drizzle-react";

import App from "./App";
import drizzleOptions from "./drizzleOptions";
import Dashboard from "./components/Dashboard.js";
import DerivativeList from "./components/DerivativeList.js";
import CreateContractModal from "./components/CreateContractModal.js";

const getNewDrizzleInstance = () => {
  // Add a custom fallback provider for testing.
  const options = { ...drizzleOptions, web3: { fallback: { url: "ws://127.0.0.1:9545" } } };
  const drizzleStore = generateStore(options);
  return new Drizzle(options, drizzleStore);
};

it("renders App without crashing", done => {
  const div = document.createElement("div");

  const params = { identifiers: [] };
  ReactDOM.render(<App drizzle={getNewDrizzleInstance()} params={params} />, div);

  // Note: timeout is to allow time for any async requests by the component to go through.
  setTimeout(() => {
    ReactDOM.unmountComponentAtNode(div);
    done();
  }, 3000);
});

const addDrizzleProviderWrapper = getComponent => {
  return (
    <DrizzleContext.Provider drizzle={getNewDrizzleInstance()}>
      <DrizzleContext.Consumer>
        {drizzleContext => {
          const { drizzle, initialized, drizzleState } = drizzleContext;

          // If drizzle hasn't gotten any state, don't load the application.
          if (!initialized) {
            return "Loading...";
          }

          return getComponent(drizzle, drizzleState);
        }}
      </DrizzleContext.Consumer>
    </DrizzleContext.Provider>
  );
};

it("renders Dashboard without crashing", done => {
  const getDashboard = (drizzle, drizzleState) => {
    const params = {
      currencies: { "0x0000000000000000000000000000000000000000": "ETH" },
      identifiers: []
    };
    return <Dashboard drizzle={drizzle} drizzleState={drizzleState} params={params} />;
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getDashboard), div);

  // Note: timeout is to allow time for any async requests by the component to go through.
  setTimeout(() => {
    ReactDOM.unmountComponentAtNode(div);
    done();
  }, 3000);
});

it("renders DerivativeList without crashing", done => {
  const getDerivativeList = (drizzle, drizzleState) => {
    return <DerivativeList drizzle={drizzle} drizzleState={drizzleState} />;
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getDerivativeList), div);

  // Note: timeout is to allow time for any async requests by the component to go through.
  setTimeout(() => {
    ReactDOM.unmountComponentAtNode(div);
    done();
  }, 3000);
});

it("renders CreateContractModal without crashing", done => {
  const getCreateContractModal = (drizzle, drizzleState) => {
    const params = { identifiers: [], currencies: {} };
    return (
      <CreateContractModal
        drizzle={drizzle}
        drizzleState={drizzleState}
        open={true}
        onClose={() => {}}
        params={params}
      />
    );
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getCreateContractModal), div);

  // Note: timeout is to allow time for any async requests by the component to go through.
  setTimeout(() => {
    ReactDOM.unmountComponentAtNode(div);
    done();
  }, 3000);
});

// TODO: add ContractDetails component test
