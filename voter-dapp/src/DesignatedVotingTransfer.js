import React from "react";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useTableStyles } from "./Styles.js";

function DesignatedVotingTransfer({ votingAccount }) {
  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const classes = useTableStyles();

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const currentAccountBalance = useCacheCall("VotingToken", "balanceOf", account);

  // Transfer tokens in the current account to the DesignatedVoting account.
  const { send: transfer, status: transferStatus } = useCacheSend("VotingToken", "transfer");
  const onTransfer = () => {
    transfer(votingAccount, currentAccountBalance);
  };

  const fetchComplete = currentAccountBalance;
  if (!fetchComplete) {
    return <div> LOADING </div>;
  }

  // No tokens in the current wallet: nothing to transfer.
  if (currentAccountBalance.toString() === "0") {
    return null;
  }

  const hasPendingTransactions = transferStatus;
  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Two key voting
      </Typography>
      <div>
        You have {web3.utils.fromWei(currentAccountBalance)} tokens that will NOT be voted with. You'll need to first
        transfer them to your DesignatedVoting instance at address {votingAccount}.
        <br />
        <b>Make sure you control the cold wallet key before transferring!</b>
      </div>
      <div>
        <Button variant="contained" color="primary" onClick={() => onTransfer()} disabled={hasPendingTransactions}>
          Transfer
        </Button>
      </div>
    </div>
  );
}

export default DesignatedVotingTransfer;
