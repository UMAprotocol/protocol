import React from "react";
import ReactDOM from "react-dom";
import { Drizzle, generateStore } from "drizzle";
import "./index.css";
import App from "./App";
import drizzleOptions from "./drizzleOptions";

// Setup drizzle.
console.log(drizzleOptions);

const drizzleStore = generateStore(drizzleOptions);
const drizzle = new Drizzle(drizzleOptions, drizzleStore);

ReactDOM.render(<App drizzle={drizzle} />, document.getElementById("root"));
