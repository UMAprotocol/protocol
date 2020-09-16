import React from "react";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import logo from "./logo.png";
import Grid from "@material-ui/core/Grid";
import { formatWei, formatWithMaxDecimals } from "@uma/common";
import BigNumber from "bignumber.js";

// MaterialUI has a number of options for styling which seem to be
// made more complicated by the React Hooks setup. When attempting to
// style this component, either edit the theme which should propogate
// through inheritance, or change the properties (props) of this component.

export default function Header({ votingAccount }) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const account = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  })).account;

  const balance = useCacheCall("VotingToken", "balanceOf", votingAccount);
  const supply = useCacheCall("VotingToken", "totalSupply");
  let tokenBalance;

  if (balance && supply) {
    const formattedBalance = formatWithMaxDecimals(formatWei(balance, web3), 2, 4, false);
    const formattedSupply = formatWithMaxDecimals(formatWei(supply, web3), 2, 4, false);
    const formattedPercentage =
      supply.toString() === "0"
        ? "0"
        : formatWithMaxDecimals(
            BigNumber(balance)
              .div(BigNumber(supply))
              .times(BigNumber(100))
              .toString(),
            2,
            4,
            false
          );
    tokenBalance = (
      <div>
        {" "}
        Your Token Balance: {formattedBalance}/{formattedSupply} ({formattedPercentage}%){" "}
      </div>
    );
  } else {
    tokenBalance = "Loading token balance...";
  }

  if (!logo) {
    return <div>Logo goes here</div>;
  }

  const textStyle = {
    paddingRight: "10px",
    paddingBottom: "3px"
  };

  const dateTimeOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    hour12: false,
    minute: "numeric"
  };

  return (
    <div>
      <Grid container direction="row" alignItems="center" justify="space-between">
        <Grid item>
          <img src={logo} alt="Logo" style={{ padding: 15 }} height="30" />
        </Grid>
        <Grid item>
          <h1>Vote Requests</h1>
        </Grid>
        <Grid item>
          <ul>
            <div align="right" style={textStyle}>
              Your Address: {account}
            </div>
            {votingAccount !== account && (
              <div align="right" style={textStyle}>
                Voting with contract: {votingAccount}
              </div>
            )}
            <div align="right" style={textStyle}>
              {tokenBalance}
            </div>
            <div align="right" style={textStyle}>
              Current Time: {new Date().toLocaleDateString(undefined, dateTimeOptions)}
            </div>
          </ul>
        </Grid>
      </Grid>
    </div>
  );
}
