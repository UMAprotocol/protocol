import React from "react";
import ReactDOM from "react-dom";
import { Drizzle, generateStore } from "drizzle";
import { DrizzleContext } from "drizzle-react";

import App from "./App";
import drizzleOptions from "./drizzleOptions";
import Dashboard from "./components/Dashboard.js";
import DerivativeList from "./components/DerivativeList.js";
import CreateContractModal from "./components/CreateContractModal.js";

it("renders App without crashing", () => {
  // Setup drizzle.
  const drizzleStore = generateStore(drizzleOptions);
  const drizzle = new Drizzle(drizzleOptions, drizzleStore);

  const div = document.createElement("div");
  ReactDOM.render(<App drizzle={drizzle} />, div);
  ReactDOM.unmountComponentAtNode(div);
});

const addDrizzleProviderWrapper = getComponent => {
  // Setup drizzle.
  const drizzleStore = generateStore(drizzleOptions);
  const drizzle = new Drizzle(drizzleOptions, drizzleStore);
  return (
    <DrizzleContext.Provider drizzle={drizzle}>
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

it("renders Dashboard without crashing", () => {
  const getDashboard = (drizzle, drizzleState) => {
    return <Dashboard drizzle={drizzle} drizzleState={drizzleState} />;
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getDashboard), div);
  ReactDOM.unmountComponentAtNode(div);
});

it("renders DerivativeList without crashing", () => {
  const getDerivativeList = (drizzle, drizzleState) => {
    return <DerivativeList drizzle={drizzle} drizzleState={drizzleState} />;
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getDerivativeList), div);
  ReactDOM.unmountComponentAtNode(div);
});

it("renders CreateContractModal without crashing", () => {
  const getCreateContractModal = (drizzle, drizzleState) => {
    return <CreateContractModal drizzle={drizzle} drizzleState={drizzleState} />;
  };

  const div = document.createElement("div");
  ReactDOM.render(addDrizzleProviderWrapper(getCreateContractModal), div);
  ReactDOM.unmountComponentAtNode(div);
});

// TODO: add ContractDetails component test
