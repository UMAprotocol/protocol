import React from "react";
import NotificationBanner from "./NotificationBanner";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";

function eslink(addr) {
  return `https://etherscan.io/address/${addr}`;
}

const OpenNewTab = link => () => window.open(link, "_blank");
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
        migrate them to a new contract. Follow the migration guide to update your 2 Key contract.
      </Typography>
      <Button color="secondary" onClick={OpenNewTab(migrationLink)}>
        <strong> Migration Guide</strong>
      </Button>
    </NotificationBanner>
  );
}

export default MigrationBanner;
