import React, { useEffect, useState } from "react";
import Header from "./Header.js";
import AppBar from "@material-ui/core/AppBar";
import ActiveRequests from "./ActiveRequests.js";
import ResolvedRequests from "./ResolvedRequests.js";
import DesignatedVotingDeployment from "./DesignatedVotingDeployment.js";
import DesignatedVotingTransfer from "./DesignatedVotingTransfer.js";
import DesignatedVoting from "@uma/core/build/contracts/DesignatedVoting.json";
import RetrieveRewards from "./RetrieveRewards.js";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { formatWithMaxDecimals, formatWei } from "@uma/common";
import MigrationBanner from "./MigrationBanner";

function Dashboard() {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));
  const { web3 } = drizzle;

  const addressZero = "0x0000000000000000000000000000000000000000";

  const deployedDesignatedVotingAddress = useCacheCall("DesignatedVotingFactory", "designatedVotingContracts", account);
  const { designatedVoting } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    designatedVoting: drizzleState.contracts[deployedDesignatedVotingAddress]
  }));

  const { shouldShowBanner, oldDesignatedVotingAddress, oldDesignatedVotingBalance } = useCacheCall(
    ["OldDesignatedVotingFactory", "VotingToken"],
    call => {
      if (!account) return {};
      const oldDesignatedVotingAddress = call("OldDesignatedVotingFactory", "designatedVotingContracts", account);
      if (!oldDesignatedVotingAddress || oldDesignatedVotingAddress === addressZero) return {};

      // Handle special case where there is no old designated voting factory so it is set to the new one.
      const { toChecksumAddress } = web3.utils;
      if (
        deployedDesignatedVotingAddress &&
        toChecksumAddress(oldDesignatedVotingAddress) === toChecksumAddress(deployedDesignatedVotingAddress)
      )
        return {};

      const balance = call("VotingToken", "balanceOf", oldDesignatedVotingAddress);
      if (!balance) return {};

      const balanceBN = web3.utils.toBN(balance.toString());
      const shouldShowBanner = !balanceBN.isZero();
      const formattedBalance = formatWithMaxDecimals(formatWei(balance, web3), 2, 4, false);

      return { shouldShowBanner, oldDesignatedVotingAddress, oldDesignatedVotingBalance: formattedBalance };
    }
  );

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

  let designatedVotingHelpers = "";
  if (hasDesignatedVoting) {
    if (designatedVoting) {
      votingGateway = deployedDesignatedVotingAddress;
      // The user has a DesignatedVoting instance deployed: load the component that checks that the user doesn't have
      // tokens in the current wallet instead.
      designatedVotingHelpers = (
        <div>
          <DesignatedVotingTransfer votingAccount={votingGateway} />
        </div>
      );
    } else {
      // Waiting for drizzle finish loading DesignatedVoting.
      return <div>LOADING</div>;
    }
  } else {
    // The user doesn't have a DesignatedVoting instance deployed: load the component that allows them to deploy one.
    designatedVotingHelpers = (
      <div>
        <DesignatedVotingDeployment votingAccount={account} />
      </div>
    );
  }
  // If commits/reveals are through a DesignatedVoting instance, then the address of the DesignatedVoting is the
  // voting account as far as `Voting.sol` is concerned.
  const votingAccount = votingGateway === "Voting" ? account : votingGateway;

  return (
    <div>
      <AppBar color="secondary" position="static">
        <Header votingAccount={votingAccount} />
      </AppBar>

      {shouldShowBanner && (
        <MigrationBanner oldDesignatedVotingAddress={oldDesignatedVotingAddress} balance={oldDesignatedVotingBalance} />
      )}
      {designatedVotingHelpers}
      <RetrieveRewards votingAccount={votingAccount} />
      <ActiveRequests votingGateway={votingGateway} votingAccount={votingAccount} snapshotContract="Voting" />
      <ResolvedRequests votingAccount={votingAccount} />
    </div>
  );
}

export default Dashboard;
