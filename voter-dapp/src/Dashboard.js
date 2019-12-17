import React, { useEffect, useState } from "react";
import Header from "./Header.js";
import AppBar from "@material-ui/core/AppBar";
import ActiveRequests from "./ActiveRequests.js";
import ResolvedRequests from "./ResolvedRequests.js";
import DesignatedVoting from "./contracts/DesignatedVoting.json";

import { drizzleReactHooks } from "drizzle-react";

function Dashboard() {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const addressZero = "0x0000000000000000000000000000000000000000";

  const deployedDesignatedVotingAddress = useCacheCall("DesignatedVotingFactory", "designatedVotingContracts", account);
  const { designatedVoting } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    designatedVoting: drizzleState.contracts[deployedDesignatedVotingAddress]
  }));

  // We only want to run `drizzle.addContract` once, even if a change deep inside the `drizzle` object retriggers this
  // `useEffect`.
  const [hasAdded, setHasAdded] = useState(false);
  useEffect(() => {
    if (!deployedDesignatedVotingAddress) {
      return;
    }
    if (designatedVoting || hasAdded) {
      return;
    }
    if (deployedDesignatedVotingAddress !== addressZero) {
      drizzle.addContract({
        contractName: deployedDesignatedVotingAddress,
        web3Contract: new drizzle.web3.eth.Contract(DesignatedVoting.abi, deployedDesignatedVotingAddress)
      });
      setHasAdded(true);
    }
  }, [deployedDesignatedVotingAddress, hasAdded, drizzle, designatedVoting]);
  if (!deployedDesignatedVotingAddress) {
    // Waiting to see if the user has a deployed DesignatedVoting.
    return <div>LOADING</div>;
  }
  const hasDesignatedVoting = deployedDesignatedVotingAddress !== addressZero;
  let votingGateway = "Voting";
  let votingAccount = "";

  if (hasDesignatedVoting) {
    if (designatedVoting) {
      votingGateway = deployedDesignatedVotingAddress;
      votingAccount = deployedDesignatedVotingAddress;
    } else {
      // Waiting for drizzle finish loading DesignatedVoting.
      return <div>LOADING</div>;
    }
  }

  return (
    <div>
      <AppBar color="secondary" position="static">
        <Header votingAccount={votingAccount} />
      </AppBar>
      <ActiveRequests votingGateway={votingGateway} />
      <ResolvedRequests />
    </div>
  );
}

export default Dashboard;
