import React, { Component } from "react";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core/styles";
import { DrizzleContext } from "drizzle-react";
import "./App.css";
import Dashboard from "./components/Dashboard.js";
import params from "./parameters.json";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "#ff4a4a"
    },
    secondary: {
      main: "#272528"
    }
  },
  typography: {
    useNextVariants: true
  }
});

class App extends Component {
  state = { params, network: undefined };

  componentDidMount(){
    document.title = "UMA Dashboard";
  }

  networkIdToName(networkId) {
    switch(networkId.toString()) {
      case "1":
        return "main";
      case "3":
        return "ropsten";
      default:
        return "private";
    }
  }

  render() {
    return (
      <DrizzleContext.Provider drizzle={this.props.drizzle}>
        <DrizzleContext.Consumer>
          {drizzleContext => {
            const { drizzle, initialized, drizzleState } = drizzleContext;

            // If drizzle hasn't gotten any state, don't load the application.
            if (!initialized) {
              return "Loading...";
            }

            // Copy params without network properties
            const newParams = { ...params };
            delete newParams.main;
            delete newParams.ropsten;
            delete newParams.private;

            // Overlay network properties on top
            Object.assign(newParams, params[this.networkIdToName(drizzleState.web3.networkId)]);

            return (
              <MuiThemeProvider theme={theme}>
                <Dashboard drizzle={drizzle} drizzleState={drizzleState} params={newParams} />
              </MuiThemeProvider>
            );
          }}
        </DrizzleContext.Consumer>
      </DrizzleContext.Provider>
    );
  }
}

export default App;
