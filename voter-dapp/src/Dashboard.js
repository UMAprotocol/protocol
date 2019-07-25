import React from "react";
import ActiveRequests from "./ActiveRequests.js";
import ResolvedRequests from "./ResolvedRequests.js";

function Dashboard() {
  return (
    <div>
      Voter dApp
      <ActiveRequests />
      <ResolvedRequests />
    </div>
  );
}

export default Dashboard;
