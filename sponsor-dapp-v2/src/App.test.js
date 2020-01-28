import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter as Router } from "react-router-dom";
import { Provider } from "react-redux";
import store from "./store/store";
import App from "./components/application";
import { Drizzle } from "@umaprotocol/store";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import drizzleOptions from "drizzleOptions";

const drizzle = new Drizzle(drizzleOptions, store);

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
      <Provider store={store}>
        <Router>
          <App />
        </Router>
      </Provider>
    </drizzleReactHooks.DrizzleProvider>,
    div
  );
});
