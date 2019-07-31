import React from "react";
import { drizzleReactHooks } from "drizzle-react";
import logo from "./logo.png";
import Grid from "@material-ui/core/Grid";
import { formatDate } from "./common/FormattingUtils.js";

// MaterialUI has a number of options for styling which seem to be
// made more complicated by the React Hooks setup. When attempting to
// style this component, either edit the theme which should propogate
// through inheritance, or change the properties (props) of this component.

export default function Header() {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const account = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  })).account;

  const balance = useCacheCall("VotingToken", "balanceOf", account);
  const supply = useCacheCall("VotingToken", "totalSupply");
  let tokenBalance;

  if (balance && supply) {
    tokenBalance = (
      <div>
        {" "}
        {balance} tokens of {supply} supply is {!(balance / supply) ? 0 : (balance / supply) * 100}%{" "}
      </div>
    );
  } else {
    tokenBalance = "Loading token balance...";
  }

  if (!logo) {
    return <div>Logo goes here</div>;
  }
  return (
    <div>
      <Grid container direction="row" alignItems="center">
        <Grid item>
          <img src={logo} alt="Logo" style={{ padding: 15 }} height="30" />
        </Grid>
        <Grid item>
          <h1>Vote Requests</h1>
        </Grid>
        <Grid item>
          <ul>
            <div>User Addr = {account} </div>
            <div> {tokenBalance} </div>
            <div> Current time: {formatDate(Date.now(), drizzle.web3)} </div>
          </ul>
        </Grid>
      </Grid>
    </div>
  );
}
