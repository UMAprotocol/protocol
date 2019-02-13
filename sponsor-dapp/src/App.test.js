import React from "react";
import ReactDOM from "react-dom";
import { Drizzle, generateStore } from "drizzle";
import App from "./App";
import drizzleOptions from "./drizzleOptions";

it("renders without crashing", () => {
  // Setup drizzle.
  const drizzleStore = generateStore(drizzleOptions);
  const drizzle = new Drizzle(drizzleOptions, drizzleStore);

  const div = document.createElement("div");
  ReactDOM.render(<App drizzle={drizzle} />, div);
  ReactDOM.unmountComponentAtNode(div);
});
