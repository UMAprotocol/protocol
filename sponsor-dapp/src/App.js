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
    }
  },
  typography: {
    useNextVariants: true,
  },
});

class App extends Component {
  state = { network: null };

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

            params.network = drizzleState.web3.networkId;

            return (
              <MuiThemeProvider theme={theme}>
                <Dashboard drizzle={drizzle} drizzleState={drizzleState} params={params} />
              </MuiThemeProvider>
            );
          }}
        </DrizzleContext.Consumer>
      </DrizzleContext.Provider>
    );
  }
}

export default App;
