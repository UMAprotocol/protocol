import React, { Component } from "react";
import Typography from "@material-ui/core/Typography";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core/styles";
import { DrizzleContext } from "drizzle-react";
import "./App.css";
import Dashboard from "./components/Dashboard.js";
import params from "./parameters.json";

class App extends Component {
  state = { params, network: undefined };

  componentDidMount() {
    document.title = "UMA Dashboard";
  }

  networkIdToName(networkId) {
    switch (networkId.toString()) {
      case "1":
        return "main";
      case "3":
        return "ropsten";
      default:
        return "private";
    }
  }

  createMuiTheme(network) {
    let primaryColor;
    switch (network) {
      case "main":
      case "ropsten":
        primaryColor = "#ff4a4a";
        break;
      default:
        // DO NOT SUBMIT
        primaryColor = "#ff4a4a";
      // primaryColor = "#a44aff";
    }

    return createMuiTheme({
      palette: {
        primary: {
          main: primaryColor
        },
        secondary: {
          main: "#272528"
        }
      },
      typography: {
        useNextVariants: true,
        fontFamily: "Verdana"
      }
    });
  }

  render() {
    return (
      <DrizzleContext.Provider drizzle={this.props.drizzle}>
        <DrizzleContext.Consumer>
          {drizzleContext => {
            const { drizzle, initialized, drizzleState } = drizzleContext;

            // If drizzle hasn't gotten any state, don't load the application.
            if (!initialized) {
              // We still need a theme here to load the right CSS (e.g., the right font family).
              const theme = this.createMuiTheme("main");
              return (
                <MuiThemeProvider theme={theme}>
                  <Typography variant="body2">Loading...</Typography>
                </MuiThemeProvider>
              );
            }

            // Copy params without network properties
            const newParams = { ...params };
            delete newParams.main;
            delete newParams.ropsten;
            delete newParams.private;

            const networkName = this.networkIdToName(drizzleState.web3.networkId);
            newParams.network = networkName;

            const theme = this.createMuiTheme(networkName);

            // Overlay network properties on top
            Object.assign(newParams, params[networkName]);

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
