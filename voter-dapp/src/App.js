import React, { useState } from "react";
import { drizzleReactHooks } from "drizzle-react";
import "./App.css";
import Dashboard from "./Dashboard";
import DrizzleLogin from "./DrizzleLogin.js";
import { createMuiTheme } from "@material-ui/core/styles";
import { ThemeProvider } from "@material-ui/styles";

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
    },
    overrides: {
      MuiTableHead: {
        root: {
          background: "#b2b7bf",
          fontWeight: "750"
        }
      },
      MuiTable: {
        root: {
          background: "#e4e7ed"
        }
      }
    }
  });

  const [drizzle, setDrizzle] = useState(null);

  if (drizzle) {
    return (
      <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
        <ThemeProvider theme={theme}>
          <Dashboard />
        </ThemeProvider>
      </drizzleReactHooks.DrizzleProvider>
    );
  } else {
    return (
      <ThemeProvider theme={theme}>
        <DrizzleLogin setParentDrizzle={setDrizzle} />
      </ThemeProvider>
    );
  }
}

export default App;
