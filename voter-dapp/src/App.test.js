import React from "react";
import ReactDOM from "react-dom";
import App from "./App";

const fakeEthereumObject = {
  // Enable goes through immediately and returns 0x0 as the selected address.
  enable: async () => "0x0"
};

it("renders without crashing", () => {
  global.ethereum = fakeEthereumObject;
  const div = document.createElement("div");
  ReactDOM.render(<App />, div);
  ReactDOM.unmountComponentAtNode(div);
});
