import React from "react";
import { drizzleReactHooks } from "drizzle-react";
import "./App.css";
import ActiveRequests from "./ActiveRequests.js";

function App() {
  const drizzleState = drizzleReactHooks.useDrizzleState(drizzleState => {
    return {
      initialized: drizzleState.drizzleStatus.initialized
    };
  });
  if (!drizzleState.initialized) {
    return <div>Loading</div>;
  } else {
    return (
      <div>
        Voter dApp <ActiveRequests />
      </div>
    );
  }
}

export default App;
