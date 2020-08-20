import React, { useState } from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import "./App.css";
import Dashboard from "./Dashboard";
import DrizzleLogin from "./DrizzleLogin.js";
import { createMuiTheme } from "@material-ui/core/styles";
import { ThemeProvider } from "@material-ui/styles";

import { ApolloProvider } from "@apollo/client";
import { client } from "./apollo/client";

import VoteData from "./containers/VoteData";

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
          <ApolloProvider client={client}>
            <VoteData.Provider>
              <Dashboard />
            </VoteData.Provider>
          </ApolloProvider>
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
