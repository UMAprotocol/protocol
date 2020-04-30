import React, { useState } from "react";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Typography from "@material-ui/core/Typography";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useTableStyles } from "./Styles.js";

function DesignatedVotingDeployment({ votingAccount }) {
  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const classes = useTableStyles();

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  // A text field to hold an address.
  const [voterAddress, setVoterAddress] = useState("");
  const [errorText, setErrorText] = useState("");
  const editAddress = event => {
    if (event.target.value !== "" && !web3.utils.isAddress(event.target.value)) {
      setErrorText("Invalid address");
    } else {
      setErrorText("");
    }
    setVoterAddress(event.target.value);
  };

  const { send: deployNew, status: deployStatus } = useCacheSend("DesignatedVotingFactory", "newDesignatedVoting");
  const deploy = () => {
    if (!web3.utils.isAddress(voterAddress)) {
      return;
    }
    deployNew(voterAddress, { from: account });
  };

  // The component above this one should check before loading this component, but given re-renders, better to be safe.
  const isUsingDesignatedVoting = votingAccount !== account;
  if (isUsingDesignatedVoting) {
    return null;
  }

  const hasPendingTransactions = deployStatus === "pending";
  const disableDeployButton = hasPendingTransactions || errorText !== "" || voterAddress === "";
  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Two key voting
      </Typography>
      You are not currently using a 2 key voting system. To deploy one, provide your cold key address.
      <br />
      To learn more about the 2 key voting system see our{" "}
      <a href="https://docs.umaproject.org/uma/oracle/voting_with_UMA_2-key_contract.html" target="_blank">
        docs
      </a>
      .
      <div>
        <TextField
          helperText={errorText}
          label="Cold wallet address"
          error={errorText !== ""}
          onChange={event => editAddress(event)}
          disabled={hasPendingTransactions}
          style={{ width: 500 }}
        />
        <Button variant="contained" color="primary" onClick={() => deploy()} disabled={disableDeployButton}>
          Deploy
        </Button>
      </div>
    </div>
  );
}

export default DesignatedVotingDeployment;
