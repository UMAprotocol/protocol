import React, { useState } from "react";
import { drizzleReactHooks } from "drizzle-react";
import "./App.css";
import Dashboard from "./Dashboard";
import DrizzleLogin from "./DrizzleLogin.js";

function App() {
  const [drizzle, setDrizzle] = useState(null);

  if (drizzle) {
    return (
      <drizzleReactHooks.DrizzleProvider drizzle={drizzle}>
        <Dashboard />
      </drizzleReactHooks.DrizzleProvider>
    );
  } else {
    return <DrizzleLogin setParentDrizzle={setDrizzle} />;
  }
}

export default App;
