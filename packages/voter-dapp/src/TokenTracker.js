import React from "react";
import Button from "@material-ui/core/Button";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useTableStyles } from "./Styles.js";

function TokenTracker() {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const classes = useTableStyles();

  const addTokenToWallet = () => {
    window.web3.currentProvider.sendAsync({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address: drizzle.contracts.VotingToken.address,
          symbol: "UMA",
          decimals: 18,
          image: "https://umaproject.org/assets/images/UMA_square_red_logo.png"
        }
      },
      id: Math.round(Math.random() * 100000)
    });
  };

  return (
    <div className={classes.root}>
      <Button variant="contained" color="primary" onClick={() => addTokenToWallet()}>
        Track UMA token in your wallet
      </Button>
    </div>
  );
}

export default TokenTracker;
