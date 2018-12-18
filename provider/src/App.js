import React, { Component } from "react";
import "./App.css";
import Dashboard from "./Dashboard.js";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core/styles";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "#ff4a4a"
    }
  }
});

class App extends Component {
  componentDidMount() {
    document.title = "UMA 2XBCE Token Contract";
  }

  render() {
    return (
      <MuiThemeProvider theme={theme}>
        <Dashboard />
      </MuiThemeProvider>
    );
  }
}

export default App;
