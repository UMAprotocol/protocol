import React, { useEffect, useMemo, useState, useReducer } from "react";
import { useCookies } from "react-cookie";
import {
  Button,
  IconButton,
  Checkbox,
  Dialog,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Radio,
  RadioGroup,
  FormGroup,
  FormControlLabel,
  FormControl,
  Tooltip,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Switch
} from "@material-ui/core";
import { Help as HelpIcon, FileCopy as FileCopyIcon } from "@material-ui/icons";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import VoteData from "./containers/VoteData";
import {
  VotePhasesEnum,
  formatDate,
  decryptMessage,
  deriveKeyPairFromSignatureMetamask,
  encryptMessage,
  getKeyGenMessage,
  computeVoteHash,
  getRandomUnsignedInt,
  BATCH_MAX_COMMITS,
  BATCH_MAX_REVEALS,
  getAdminRequestId,
  getMessageSignatureMetamask,
  isAdminRequest,
  decodeTransaction,
  translateAdminVote,
  IDENTIFIER_BLACKLIST,
  getPrecisionForIdentifier,
  parseFixed,
  formatFixed
} from "@uma/common";
import { useTableStyles } from "./Styles.js";

const snapshotMessage = "Sign For Snapshot";
const snapshotHint =
  "Snapshotting is the act of recording the current UMA Token distribution for vote weighting. This needs to be done once before votes can be revealed for this round. The snapshot function cannot be called through another contract.";

const editStateReducer = (state, action) => {
  switch (action.type) {
    case "EDIT_COMMIT":
      return { ...state, [action.index]: action.price ? action.price : "0" };
    case "EDIT_COMMITTED_VALUE":
      return { ...state, [action.index]: action.price };
    case "SUBMIT_COMMIT":
      const newValues = { ...state };
      for (const index of action.indicesCommitted) {
        newValues[index] = undefined;
      }
      return newValues;
    default:
      throw new Error();
  }
};

const toPriceRequestKey = (identifier, time) => time + "," + identifier;
const toVotingAccountAndPriceRequestKey = (votingAccount, identifier, time) =>
  votingAccount + "," + time + "," + identifier;

// Snapshot button with hint, sets some default props
function SnapshotButton({ hint = snapshotHint, onClick = x => x }) {
  return (
    <div>
      <Button variant="contained" color="primary" onClick={onClick}>
        Snapshot Balances
      </Button>
      <Tooltip title={hint} placement="right">
        <IconButton>
          <HelpIcon />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function ActiveRequests({ votingAccount, votingGateway, snapshotContract }) {
  const { drizzle, useCacheCall, useCacheEvents, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  // Use cookies to locally store data from committed hashes, mapped to the current voting account.
  const [cookies, setCookie] = useCookies();
  const { hexToUtf8 } = web3.utils;
  const classes = useTableStyles();

  const [checkboxesChecked, setCheckboxesChecked] = useState({});
  const check = (index, event) => {
    setCheckboxesChecked(old => ({ ...old, [index]: event.target.checked }));
  };

  const allPendingRequests = useCacheCall("Voting", "getPendingRequests");
  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");
  const votePhase = useCacheCall("Voting", "getVotePhase");
  // currentRoundId can be undefined so we need a default value here
  const round = useCacheCall("Voting", "rounds", currentRoundId || "");

  // Only display non-blacklisted price requests (uniquely identifier by identifier name and timestamp)
  const [showSpamRequests, setShowSpamRequests] = useState(false);
  const [hasSpamRequests, setHasSpamRequests] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  useEffect(() => {
    setHasSpamRequests(false);

    if (allPendingRequests) {
      const nonBlacklistedRequests = allPendingRequests.filter(req => {
        if (!IDENTIFIER_BLACKLIST[hexToUtf8(req.identifier)]) return true;
        else {
          if (!IDENTIFIER_BLACKLIST[hexToUtf8(req.identifier)].includes(req.time)) {
            return true;
          } else return false;
        }
      });
      // If there is at least 1 spam request, set this flag which we'll use to determine whether to show the spam filter switch to users.
      if (nonBlacklistedRequests.length < allPendingRequests.length) {
        setHasSpamRequests(true);
      }

      if (showSpamRequests) {
        setPendingRequests(allPendingRequests);
      } else {
        setPendingRequests(nonBlacklistedRequests);
      }
    }
  }, [allPendingRequests, IDENTIFIER_BLACKLIST, showSpamRequests]);

  const { roundVoteData, getRequestKey } = VoteData.useContainer();

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const initialFetchComplete = pendingRequests && currentRoundId && votePhase && account;

  const revealEvents = useCacheEvents(
    "Voting",
    "VoteRevealed",
    useMemo(() => ({ filter: { voter: votingAccount, roundId: currentRoundId }, fromBlock: 0 }), [
      votingAccount,
      currentRoundId
    ])
  );

  const encryptedVoteEvents = useCacheEvents(
    "Voting",
    "EncryptedVote",
    useMemo(() => ({ filter: { voter: votingAccount, roundId: currentRoundId }, fromBlock: 0 }), [
      votingAccount,
      currentRoundId
    ])
  );

  const closedDialogIndex = -1;
  const [dialogContentIndex, setDialogContentIndex] = useState(closedDialogIndex);
  const [commitBackupIndex, setCommitBackupIndex] = useState(closedDialogIndex);
  const [openVoteStatsDialog, setOpenVoteStatsDialog] = useState(false);
  const [voteStatsDialogData, setVoteStatDialogData] = useState(null);

  const handleClickExplain = index => {
    setDialogContentIndex(index);
  };

  const handleClickDisplayCommitBackup = index => {
    setCommitBackupIndex(index);
  };

  const handleClickStats = index => {
    // Set voteStatsDialogData to stats from selected round.
    const priceRequest = pendingRequests[index];
    if (priceRequest) {
      const voteDataKey = getRequestKey(priceRequest.time, hexToUtf8(priceRequest.identifier), currentRoundId);
      if (roundVoteData?.[voteDataKey]) {
        setVoteStatDialogData(roundVoteData[voteDataKey]);
        setOpenVoteStatsDialog(true);
      }
    }
  };

  const prettyFormatNumber = x => {
    if (!x) {
      return "N/A";
    }
    return Number(x).toLocaleString({ minimumFractionDigits: 2 });
  };

  const handleClickClose = () => {
    setDialogContentIndex(closedDialogIndex);
    setCommitBackupIndex(closedDialogIndex);
    setOpenVoteStatsDialog(false);
  };

  const proposals = useCacheCall(["Governor"], call => {
    if (!initialFetchComplete) {
      return null;
    }
    return pendingRequests.map(request => ({
      proposal: isAdminRequest(hexToUtf8(request.identifier))
        ? call("Governor", "getProposal", getAdminRequestId(hexToUtf8(request.identifier)))
        : null
    }));
  });
  const decodeRequestIndex = index => {
    if (index === closedDialogIndex) {
      return "";
    }
    const proposal = proposals[index].proposal;
    let output =
      hexToUtf8(pendingRequests[index].identifier) + " (" + proposal.transactions.length + " transaction(s))";
    for (let i = 0; i < proposal.transactions.length; i++) {
      const transaction = proposal.transactions[i];
      output += "\n\nTransaction #" + i + ":\n" + decodeTransaction(transaction);
    }
    return output;
  };

  const voteStatuses = [];
  if (initialFetchComplete && encryptedVoteEvents !== undefined) {
    // Sort ascending by time.
    encryptedVoteEvents.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      if (a.transactionIndex !== b.transactionIndex) {
        return a.transactionIndex - b.transactionIndex;
      }

      return a.logIndex - b.logIndex;
    });
    // Get the latest `encryptedVote` for each (identifier, time).
    const encryptedVoteMap = {};
    for (const ev of encryptedVoteEvents) {
      encryptedVoteMap[toPriceRequestKey(ev.returnValues.identifier, ev.returnValues.time)] =
        ev.returnValues.encryptedVote;
    }
    for (const request of pendingRequests) {
      voteStatuses.push({ committedValue: encryptedVoteMap[toPriceRequestKey(request.identifier, request.time)] });
    }
  }

  const subsequentFetchComplete =
    initialFetchComplete &&
    encryptedVoteEvents &&
    voteStatuses.length === pendingRequests.length &&
    proposals &&
    proposals.every(prop => prop.proposal !== undefined);
  // Future hook calls that depend on `voteStatuses` should use `voteStatusesStringified` in their dependencies array
  // because `voteStatuses` will never compare equal after a re-render, even if no values in it actually changed.
  // Also note that `JSON.stringify` doesn't distinguish `undefined` and `null`, but in Drizzle, those mean different
  // things and should retrigger dependent hooks. The replace function (the second argument) stringifies `undefined` to
  // the string `"undefined"`, so that it can be distinguished from the string `"null"`.
  const voteStatusesStringified = JSON.stringify(voteStatuses, (k, v) => (v === undefined ? "undefined" : v));

  // The decryption key is a function of the account and `currentRoundId`, so we need the user to re-sign a message
  // any time one of those changes. We also don't want to show multiple, identical notifications when this effect gets
  // cleaned up on unrelated re-renders. The best solution I've come up with so far is to store the keys in a nested map
  // (i.e., Object) from account => roundId => key. When a signing request is sent out (i.e., the user is shown a
  // Metamask popup), we inject a special `messageSigningProcessingToken` at `decryptionKeys[account][currentRoundId]`
  // to prevent resending that request. Note that in this approach, we don't disregard the result of this hook on
  // component unmount.
  const [decryptionKeys, setDecryptionKeys] = useState({});
  useEffect(() => {
    async function getDecryptionKey() {
      if (!account || !currentRoundId) {
        return;
      }
      // TODO(ptare): Handle the user refusing to sign the message.
      const { privateKey, publicKey } = await deriveKeyPairFromSignatureMetamask(
        web3,
        getKeyGenMessage(currentRoundId),
        account
      );
      setDecryptionKeys(prev => ({
        ...prev,
        [account]: { ...prev[account], [currentRoundId]: { privateKey, publicKey } }
      }));
    }

    getDecryptionKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentRoundId]);
  const decryptionKeyAcquired = decryptionKeys[account] && decryptionKeys[account][currentRoundId];

  const [decryptedCommits, setDecryptedCommits] = useState([]);
  useEffect(() => {
    // If this effect got cleaned up and rerun while any async calls were pending, the results of those calls should be
    // disregarded.
    let didCancel = false;

    async function decryptAll() {
      if (!subsequentFetchComplete || !decryptionKeyAcquired) {
        return;
      }
      const currentVotes = await Promise.all(
        voteStatuses.map(async (voteStatus, index) => {
          if (voteStatus.committedValue) {
            return JSON.parse(
              await decryptMessage(decryptionKeys[account][currentRoundId].privateKey, voteStatus.committedValue)
            );
          } else {
            return "";
          }
        })
      );
      if (!didCancel) {
        setDecryptedCommits(currentVotes);
      }
    }

    decryptAll().catch(err => console.log(err));
    return () => {
      didCancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsequentFetchComplete, voteStatusesStringified, decryptionKeys, account]);
  const decryptionComplete = decryptedCommits && voteStatuses && decryptedCommits.length === voteStatuses.length;

  const { send: batchRevealFunction, status: revealStatus } = useCacheSend(votingGateway, "batchReveal");
  const { send: snapshotCurrentRound, status: snapshotStatus } = useCacheSend(snapshotContract, "snapshotCurrentRound");

  const onSnapshotHandler = () => {
    const hashedSnapshotMessage = web3.utils.soliditySha3(snapshotMessage);
    return getMessageSignatureMetamask(web3, hashedSnapshotMessage, account)
      .then(signature => {
        return snapshotCurrentRound(signature, { from: account });
      })
      .catch(err => console.log("snapshot error", err));
  };

  const onClickHandler = () => {
    const reveals = [];
    for (const index in checkboxesChecked) {
      if (checkboxesChecked[index]) {
        reveals.push({
          identifier: pendingRequests[index].identifier,
          time: pendingRequests[index].time,
          price: decryptedCommits[index].price.toString(),
          salt: decryptedCommits[index].salt
        });
      }
    }
    batchRevealFunction(reveals, { from: account });
    setCheckboxesChecked({});
  };

  const [editState, dispatchEditState] = useReducer(editStateReducer, {});

  const { send: batchCommitFunction, status: commitStatus } = useCacheSend(votingGateway, "batchCommit");

  const onSaveHandler = async () => {
    const commits = [];
    const indicesCommitted = [];

    // We'll mark all of these potential commits with the same timestamp
    // for the user's convenience.
    const encryptionTimestamp = Date.now();

    for (const index in editState) {
      if (!checkboxesChecked[index] || !editState[index]) {
        continue;
      }
      const identifierPrecision = getPrecisionForIdentifier(hexToUtf8(pendingRequests[index].identifier));
      const price = parseFixed(editState[index], identifierPrecision).toString();
      const salt = getRandomUnsignedInt().toString();
      const encryptedVote = await encryptMessage(
        decryptionKeys[account][currentRoundId].publicKey,
        JSON.stringify({ price, salt })
      );
      commits.push({
        identifier: pendingRequests[index].identifier,
        time: pendingRequests[index].time,
        hash: computeVoteHash({
          price,
          salt,
          account: votingAccount,
          time: pendingRequests[index].time,
          roundId: currentRoundId,
          identifier: pendingRequests[index].identifier
        }),
        encryptedVote
      });
      indicesCommitted.push(index);

      // Store price and salt that we will attempt to encrypt on-chain in a cookie. This way, if the encryption
      // (or subsequent decryption) fails, then the user can still recover their committed price and salt and
      // reveal their commit manually. Note that this will store a cookie for each call to `encryptMessage`, even
      // if the user never signs and submits the `batchCommitFunction` to commit their vote on-chain. Therefore,
      // the cookies could store more hash data than the user ends up committing on-chain. It is the user's
      // responsibility to determine which commit data to use.
      const newCommitKey = toVotingAccountAndPriceRequestKey(
        votingAccount,
        pendingRequests[index].identifier,
        pendingRequests[index].time
      );
      const updatedCommitBackups = Object.assign(
        {},
        {
          ...cookies[newCommitKey],
          [encryptionTimestamp]: {
            salt,
            price,
            identifierPrecision
          }
        }
      );
      setCookie(newCommitKey, updatedCommitBackups, { path: "/" });
    }
    if (commits.length < 1) {
      return;
    }

    // Prompt user to sign transaction. After this function is called, the `commitStatus` is reset to undefined.
    // Note that `commitStatus` for this transaction will fail to update correctly if the user hits "Save" again
    // and enqueues another transaction to sign. Therefore, `commitStatus` only tracks the status of the most recent
    // transaction that Drizzle sends to MetaMask to sign.
    batchCommitFunction(commits, { from: account });
    setCheckboxesChecked({});
    dispatchEditState({ type: "SUBMIT_COMMIT", indicesCommitted });
  };

  // NOTE: No calls to React hooks from this point forward.
  if (
    !initialFetchComplete ||
    !subsequentFetchComplete ||
    !revealEvents ||
    !decryptionKeyAcquired ||
    !decryptionComplete
  ) {
    return <div>Looking up requests</div>;
  }

  const eventsMap = {};
  for (const reveal of revealEvents) {
    const identifierPrecision = getPrecisionForIdentifier(hexToUtf8(reveal.returnValues.identifier));
    eventsMap[toPriceRequestKey(reveal.returnValues.identifier, reveal.returnValues.time)] = formatFixed(
      reveal.returnValues.price,
      identifierPrecision
    );
  }

  const hasPendingTransactions = revealStatus === "pending" || commitStatus === "pending";
  const statusDetails = voteStatuses.map((voteStatus, index) => {
    const pendingRequest = pendingRequests[index];

    let currentVote = "";
    if (voteStatus.committedValue && decryptedCommits[index].price) {
      const identifierPrecision = getPrecisionForIdentifier(hexToUtf8(pendingRequests[index].identifier));
      currentVote = formatFixed(decryptedCommits[index].price, identifierPrecision);
    }
    if (votePhase.toString() === VotePhasesEnum.COMMIT) {
      return {
        statusString: "Commit",
        currentVote: currentVote,
        enabled: editState[index] && !hasPendingTransactions
      };
    }
    // In the REVEAL phase.
    const revealEvent = eventsMap[toPriceRequestKey(pendingRequest.identifier, pendingRequest.time)];
    if (revealEvent) {
      return {
        statusString: "Revealed",
        currentVote: revealEvent,
        enabled: false
      };
    }
    // In the REVEAL phase, but the vote hasn't been revealed (yet).
    if (voteStatus.committedValue) {
      return { statusString: "Reveal", currentVote: currentVote, enabled: !hasPendingTransactions };
    } else {
      return { statusString: "Cannot be revealed", currentVote: "", enabled: false };
    }
  });

  const canExecuteBatch = limit => {
    let totalSelected = 0;
    for (let checked in checkboxesChecked) {
      totalSelected += checkboxesChecked[checked];
    }
    return totalSelected <= limit;
  };

  const snapshotButtonShown =
    votePhase.toString() === VotePhasesEnum.REVEAL && round && round.snapshotId === "0" && pendingRequests.length > 0;
  const revealButtonShown = votePhase.toString() === VotePhasesEnum.REVEAL && round && round.snapshotId !== "0";
  const revealButtonEnabled =
    statusDetails.some(statusDetail => statusDetail.enabled) && canExecuteBatch(BATCH_MAX_REVEALS);
  const saveButtonShown = votePhase.toString() === VotePhasesEnum.COMMIT;
  const saveButtonEnabled =
    Object.values(checkboxesChecked).some(checked => checked) && canExecuteBatch(BATCH_MAX_COMMITS);

  const editCommit = index => {
    dispatchEditState({ type: "EDIT_COMMIT", index, price: statusDetails[index].currentVote });
  };
  const editCommittedValue = (index, event) => {
    dispatchEditState({ type: "EDIT_COMMITTED_VALUE", index, price: event.target.value });
  };
  const getCommittedData = index => {
    if (index === closedDialogIndex) {
      return "";
    }
    const commitKey = toVotingAccountAndPriceRequestKey(
      votingAccount,
      pendingRequests[index].identifier,
      pendingRequests[index].time
    );
    return cookies[commitKey];
  };
  const getCurrentVoteCell = (index, isAdminVote) => {
    // If this cell is currently being edited.
    if (editState[index]) {
      // If the vote is an admin vote, display radio buttons: "yes" and "no".
      if (isAdminVote) {
        return (
          <FormControl component="fieldset">
            <RadioGroup
              aria-label="admin-vote"
              name="admin-vote"
              value={editState[index]}
              onChange={event => editCommittedValue(index, event)}
            >
              <FormControlLabel value={"1"} control={<Radio />} label={translateAdminVote("1")} />
              <FormControlLabel value={"0"} control={<Radio />} label={translateAdminVote("0")} />
            </RadioGroup>
          </FormControl>
        );
      } else {
        return (
          <TextField
            type="number"
            defaultValue={statusDetails[index].currentVote}
            onChange={event => editCommittedValue(index, event)}
          />
        );
      }
    } else {
      return (
        <span>
          {isAdminVote && statusDetails[index].currentVote
            ? translateAdminVote(statusDetails[index].currentVote)
            : statusDetails[index].currentVote}{" "}
          {saveButtonShown ? (
            <Button
              variant="contained"
              color="primary"
              style={{ marginLeft: "5px" }}
              disabled={hasPendingTransactions}
              onClick={() => editCommit(index)}
            >
              Edit
            </Button>
          ) : (
            ""
          )}
        </span>
      );
    }
  };

  const copyStringToClipboard = string => {
    // Source for implementation details: https://stackoverflow.com/questions/400212/how-do-i-copy-to-the-clipboard-in-javascript
    if (!navigator.clipboard) {
      // Synchronously copy
      const textArea = document.createElement("textarea");
      textArea.value = string;

      // Avoid scrolling to bottom
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        const successful = document.execCommand("copy");
        const msg = successful ? "successful" : "unsuccessful";
        console.log("Sync: Copying text command was " + msg);
      } catch (err) {
        console.error("Sync: Could not copy text: ", err);
      }

      document.body.removeChild(textArea);
    } else {
      // Asynchronously copy. This has been the way to copy to the clipboard for Chrome since v66.
      navigator.clipboard.writeText(string).then(
        function() {
          console.log(`Async: Copied to clipboard`);
        },
        function(err) {
          console.error("Async: Could not copy text: ", err);
        }
      );
    }
  };

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Active Requests
      </Typography>
      <Dialog open={dialogContentIndex !== closedDialogIndex} onClose={handleClickClose}>
        <DialogContent>
          <DialogContentText style={{ whiteSpace: "pre-wrap" }}>
            {decodeRequestIndex(dialogContentIndex)}
          </DialogContentText>
        </DialogContent>
      </Dialog>
      <Dialog onClose={handleClickClose} open={openVoteStatsDialog}>
        <DialogTitle>Voting Statistics</DialogTitle>
        {voteStatsDialogData && (
          <List>
            <ListItem>
              <ListItemText
                primary={"Total Supply Snapshot: " + prettyFormatNumber(voteStatsDialogData.totalSupplyAtSnapshot)}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Unique Commit Addresses: " + prettyFormatNumber(voteStatsDialogData.uniqueCommits)}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Revealed Votes: " + prettyFormatNumber(voteStatsDialogData.revealedVotes)}
                secondary={prettyFormatNumber(voteStatsDialogData.revealedVotesPct) + "% of Total Supply"}
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary={"Unique Reveal Addresses: " + prettyFormatNumber(voteStatsDialogData.uniqueReveals)}
                secondary={
                  prettyFormatNumber(voteStatsDialogData.uniqueRevealsPctOfCommits) + "% of Unique Commit Addresses"
                }
              />
            </ListItem>
          </List>
        )}
      </Dialog>
      <Dialog open={commitBackupIndex !== closedDialogIndex} onClose={handleClickClose}>
        <DialogContent>
          <DialogContentText style={{ whiteSpace: "pre-wrap" }}>
            {getCommittedData(commitBackupIndex) && Object.keys(getCommittedData(commitBackupIndex)).length > 0
              ? Object.keys(getCommittedData(commitBackupIndex)).map((timestamp, i) => {
                  return (
                    <span>
                      {`${i + 1}. Commit hash encrypted @ ${new Date(Number(timestamp)).toString().toString()}`}
                      <br />
                      {"-     Salt: " + getCommittedData(commitBackupIndex)[timestamp].salt.slice(0, 3) + "... "}
                      <IconButton
                        onClick={() => copyStringToClipboard(getCommittedData(commitBackupIndex)[timestamp].salt)}
                      >
                        <FileCopyIcon />
                      </IconButton>
                      <br />
                      {"-     Price: " +
                        formatFixed(
                          getCommittedData(commitBackupIndex)[timestamp].price,
                          getCommittedData(commitBackupIndex)[timestamp].identifierPrecision
                        )}
                      <br />
                      {"-     Price Raw: " + getCommittedData(commitBackupIndex)[timestamp].price}
                      <br />
                      <br />
                    </span>
                  );
                })
              : "Commit backup for this request not found"}
          </DialogContentText>
        </DialogContent>
      </Dialog>
      {/* Only render this spam filter switch if some pending spam requests have been filtered out */}
      {hasSpamRequests && (
        <FormGroup>
          <FormControlLabel
            control={
              <Switch size="small" checked={showSpamRequests} onChange={() => setShowSpamRequests(!showSpamRequests)} />
            }
            label="Show spam price requests"
          />
        </FormGroup>
      )}
      <Table style={{ marginBottom: "10px" }}>
        <TableHead>
          <TableRow>
            <TableCell className={classes.tableHeaderCell}>Price Feed</TableCell>
            <TableCell className={classes.tableHeaderCell}>
              <Checkbox disabled />
            </TableCell>
            <TableCell className={classes.tableHeaderCell}>Timestamp</TableCell>
            <TableCell className={classes.tableHeaderCell}>Status</TableCell>
            <TableCell className={classes.tableHeaderCell}>
              Current Vote
              <Tooltip
                title="This is your most recently committed price for this request. We decrypt this value from your on-chain encrypted commit using your private key signature."
                placement="top"
              >
                <IconButton>
                  <HelpIcon />
                </IconButton>
              </Tooltip>
            </TableCell>
            <TableCell className={classes.tableHeaderCell}>Stats</TableCell>
            <TableCell className={classes.tableHeaderCell}>
              Local Commit Data Backup
              <Tooltip
                title="Your commit includes the price, salt, identifier, and timestamp that must be revealed during the vote reveal stage. In the event that the application fails to record this info on-chain, it is saved in the browser so you can do a manual reveal."
                placement="top"
              >
                <IconButton>
                  <HelpIcon />
                </IconButton>
              </Tooltip>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody className={classes.tableBody}>
          {pendingRequests.map((pendingRequest, index) => {
            return (
              <TableRow key={index}>
                <TableCell>
                  <span>
                    {hexToUtf8(pendingRequest.identifier)}{" "}
                    {isAdminRequest(hexToUtf8(pendingRequest.identifier)) && (
                      <Button variant="contained" color="primary" onClick={() => handleClickExplain(index)}>
                        Explain
                      </Button>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <Checkbox
                    disabled={!statusDetails[index].enabled}
                    color="primary"
                    checked={checkboxesChecked[index] ? true : false}
                    onChange={event => check(index, event)}
                  />
                </TableCell>
                <TableCell>{formatDate(pendingRequest.time, drizzle.web3)}</TableCell>
                <TableCell>{statusDetails[index].statusString}</TableCell>
                <TableCell>{getCurrentVoteCell(index, isAdminRequest(hexToUtf8(pendingRequest.identifier)))}</TableCell>
                <TableCell>
                  <span>
                    <Button variant="contained" color="primary" onClick={() => handleClickStats(index)}>
                      Vote Stats
                    </Button>
                  </span>
                </TableCell>
                <TableCell>
                  <Button variant="contained" color="primary" onClick={() => handleClickDisplayCommitBackup(index)}>
                    Display
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {snapshotButtonShown && <SnapshotButton onClick={onSnapshotHandler} hint={snapshotHint} />}
      {revealButtonShown && (
        <Button
          variant="contained"
          color="primary"
          disabled={hasPendingTransactions || !revealButtonEnabled}
          onClick={() => onClickHandler()}
        >
          Reveal selected
        </Button>
      )}
      {saveButtonShown ? (
        <Button
          variant="contained"
          color="primary"
          disabled={hasPendingTransactions || !saveButtonEnabled}
          onClick={() => onSaveHandler()}
        >
          Save
        </Button>
      ) : (
        ""
      )}
      {(saveButtonShown && !canExecuteBatch(BATCH_MAX_COMMITS)) ||
      (revealButtonShown && !canExecuteBatch(BATCH_MAX_REVEALS)) ? (
        <span style={{ paddingLeft: "10px", color: "#FF4F4D" }}>
          You can only {saveButtonShown ? `commit up to ${BATCH_MAX_COMMITS}` : `reveal up to ${BATCH_MAX_REVEALS}`}{" "}
          requests at once. Please select fewer.
        </span>
      ) : (
        ""
      )}
    </div>
  );
}

export default ActiveRequests;
