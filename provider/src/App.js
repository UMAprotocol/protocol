import React, { Component } from "react";
import "./App.css";
import Dashboard from "./Dashboard.js";

class App extends Component {

  componentDidMount(){
    document.title = "UMA 2XBCE Token Contract"
  }

  render() {
    return <Dashboard />;
  }
}

export default App;
