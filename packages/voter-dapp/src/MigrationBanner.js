import React from "react";
import NotificationBanner from "./NotificationBanner";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";

function eslink(addr) {
  return `https://etherscan.io/address/${addr}`;
}

// This is ok to hard code for now
const migrationLink = "https://docs.google.com/document/d/1dVQuMwiVsSEtlPFFl7AsCDe02-njgfLCLZr7a7zGUNo";

// passing in balance is optional.
function MigrationBanner({ oldDesignatedVotingAddress, balance }) {
  return (
    <NotificationBanner>
      <Typography>
        Warning: You have an old 2 Key contract&nbsp;
        <a href={eslink(oldDesignatedVotingAddress)} rel="noopener noreferrer" target="_blank">
          here
        </a>
        &nbsp;which holds {balance} <strong>UMA</strong> tokens. These tokens will not count towards a vote until you
        migrate them to a new contract. Follow the&nbsp;
        <strong>
          <a href={migrationLink} rel="noopener noreferrer" target="_blank">
            migration guide
          </a>
        </strong>
        &nbsp;to update your 2 Key contract.
      </Typography>
    </NotificationBanner>
  );
}

export default MigrationBanner;
