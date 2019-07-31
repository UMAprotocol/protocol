import React, { useState } from "react";
import { drizzleReactHooks } from "drizzle-react";
import "./App.css";
import Dashboard from "./Dashboard";
import DrizzleLogin from "./DrizzleLogin.js";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";

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

  const [drizzle, setDrizzle] = useState(null);

  if (drizzle) {
    return (
      <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
        <MuiThemeProvider theme={theme}>
          <Dashboard />
        </MuiThemeProvider>
      </drizzleReactHooks.DrizzleProvider>
    );
  } else {
    return (
      <MuiThemeProvider theme={theme}>
        <DrizzleLogin setParentDrizzle={setDrizzle} />
      </MuiThemeProvider>
    );
  }
}

export default App;
