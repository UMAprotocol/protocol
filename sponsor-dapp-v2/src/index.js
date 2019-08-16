import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter as Router } from "react-router-dom";
import { Provider } from "react-redux";
import store from "./store/store";
import App from "./components/application";
import { Drizzle } from "drizzle";
import { drizzleReactHooks } from "drizzle-react";
import drizzleOptions from "drizzleOptions";

import "assets/scss/style.scss";

const drizzle = new Drizzle(drizzleOptions, store);

ReactDOM.render(
  <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
    <Provider store={store}>
      <Router>
        <App />
      </Router>
    </Provider>
  </drizzleReactHooks.DrizzleProvider>,

  document.getElementById("root")
);
