import React from "react";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import { drizzleReactHooks } from "drizzle-react";
import "./App.css";
import Header from "./Header.js";
import ActiveRequests from "./ActiveRequests.js";
import AppBar from "@material-ui/core/AppBar";

function App() {
  const theme = createMuiTheme({
    palette: {
      primary: {
        main: "#FF4A4A"
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

  const drizzleState = drizzleReactHooks.useDrizzleState(drizzleState => {
    return {
      initialized: drizzleState.drizzleStatus.initialized
    };
  });
  if (!drizzleState.initialized) {
    return (
      <MuiThemeProvider theme={theme}>
        <Typography variant="body2">Loading...</Typography>
      </MuiThemeProvider>
    );
  } else {
    return (
      <MuiThemeProvider theme={theme}>
        <AppBar color="secondary">
          <Header />
        </AppBar>
        Voter dApp <ActiveRequests />
      </MuiThemeProvider>
    );
  }
}

export default App;
