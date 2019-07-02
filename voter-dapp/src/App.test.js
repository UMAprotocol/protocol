import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import { Drizzle, generateStore } from "drizzle";
import { drizzleReactHooks } from "drizzle-react";
import drizzleOptions from "./drizzleOptions";

const getNewDrizzleInstance = () => {
  // Add a custom fallback provider for testing.
  const options = { ...drizzleOptions, web3: { fallback: { url: "ws://127.0.0.1:9545" } } };
  const drizzleStore = generateStore(options);
  return new Drizzle(options, drizzleStore);
};

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <drizzleReactHooks.DrizzleProvider drizzle={getNewDrizzleInstance()}>
      <App />
    </drizzleReactHooks.DrizzleProvider>,
    div
  );
  ReactDOM.unmountComponentAtNode(div);
});
