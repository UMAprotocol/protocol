import React from "react";
import Header from "./Header.js";
import AppBar from "@material-ui/core/AppBar";
import ActiveRequests from "./ActiveRequests.js";
import ResolvedRequests from "./ResolvedRequests.js";

function Dashboard() {
  return (
    <div>
      <AppBar color="secondary">
        <Header />
      </AppBar>
      Voter dApp
      <ActiveRequests />
      <ResolvedRequests />
    </div>
  );
}

export default Dashboard;
