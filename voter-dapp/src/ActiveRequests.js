import React, { useEffect, useMemo, useState, useReducer } from "react";
import Button from "@material-ui/core/Button";
import Checkbox from "@material-ui/core/Checkbox";
import { drizzleReactHooks } from "drizzle-react";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import TextField from "@material-ui/core/TextField";
import Typography from "@material-ui/core/Typography";

import { formatDate, formatWei } from "./common/FormattingUtils.js";
import { VotePhasesEnum } from "./common/Enums.js";
import { decryptMessage, deriveKeyPairFromSignatureMetamask, encryptMessage } from "./common/Crypto.js";
import { useTableStyles } from "./Styles.js";
const { getKeyGenMessage } = require("./common/EncryptionHelper.js");

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

function ActiveRequests({ votingAccount, votingGateway }) {
  const { drizzle, useCacheCall, useCacheEvents, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const classes = useTableStyles();

  const [checkboxesChecked, setCheckboxesChecked] = useState({});
  const check = (index, event) => {
    setCheckboxesChecked(old => ({ ...old, [index]: event.target.checked }));
  };

  const pendingRequests = useCacheCall("Voting", "getPendingRequests");
  const currentRoundId = useCacheCall("Voting", "getCurrentRoundId");
  const votePhase = useCacheCall("Voting", "getVotePhase");
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

  const voteStatuses = useCacheCall(["Voting"], call => {
    if (!initialFetchComplete) {
      return null;
    }
    return pendingRequests.map(request => ({
      committedValue: call(
        "Voting",
        "getMessage",
        votingAccount,
        web3.utils.soliditySha3(request.identifier, request.time, currentRoundId)
      )
    }));
  });
  const subsequentFetchComplete =
    voteStatuses &&
    // Each of the subfetches has to complete. In drizzle, `undefined` means incomplete, while `null` means complete
    // but the fetched value was null, e.g., no `comittedValue` existed.
    voteStatuses.every(voteStatus => voteStatus.committedValue !== undefined);
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

    decryptAll();
    return () => {
      didCancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsequentFetchComplete, voteStatusesStringified, decryptionKeys, account]);
  const decryptionComplete = decryptedCommits && voteStatuses && decryptedCommits.length === voteStatuses.length;

  const { send: batchRevealFunction, status: revealStatus } = useCacheSend(votingGateway, "batchReveal");
  const onClickHandler = () => {
    const reveals = [];
    for (const index in checkboxesChecked) {
      if (checkboxesChecked[index]) {
        reveals.push({
          identifier: pendingRequests[index].identifier,
          time: pendingRequests[index].time,
          price: decryptedCommits[index].price.toString(),
          salt: web3.utils.hexToNumberString(decryptedCommits[index].salt)
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
    for (const index in editState) {
      if (!checkboxesChecked[index] || !editState[index]) {
        continue;
      }
      const price = web3.utils.toWei(editState[index]);
      const salt = web3.utils.toBN(web3.utils.randomHex(32));
      const encryptedVote = await encryptMessage(
        decryptionKeys[account][currentRoundId].publicKey,
        JSON.stringify({ price, salt })
      );
      commits.push({
        identifier: pendingRequests[index].identifier,
        time: pendingRequests[index].time,
        hash: web3.utils.soliditySha3(price, salt),
        encryptedVote
      });
      indicesCommitted.push(index);
    }
    if (commits.length < 1) {
      return;
    }
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

  const toPriceRequestKey = (identifier, time) => time + "," + identifier;
  const eventsMap = {};
  for (const reveal of revealEvents) {
    eventsMap[toPriceRequestKey(reveal.returnValues.identifier, reveal.returnValues.time)] = formatWei(
      reveal.returnValues.price,
      web3
    );
  }

  const hasPendingTransactions = revealStatus === "pending" || commitStatus === "pending";
  const statusDetails = voteStatuses.map((voteStatus, index) => {
    let currentVote = "";
    if (voteStatus.committedValue && decryptedCommits[index].price) {
      currentVote = formatWei(decryptedCommits[index].price, web3);
    }
    if (votePhase.toString() === VotePhasesEnum.COMMIT) {
      return {
        statusString: "Commit",
        currentVote: currentVote,
        enabled: editState[index] && !hasPendingTransactions
      };
    }
    // In the REVEAL phase.
    const pendingRequest = pendingRequests[index];
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
  const revealButtonShown = votePhase.toString() === VotePhasesEnum.REVEAL;
  const revealButtonEnabled = statusDetails.some(statusDetail => statusDetail.enabled);
  const saveButtonShown = votePhase.toString() === VotePhasesEnum.COMMIT;
  const saveButtonEnabled = Object.values(checkboxesChecked).some(checked => checked);

  const editCommit = index => {
    dispatchEditState({ type: "EDIT_COMMIT", index, price: statusDetails[index].currentVote });
  };
  const editCommittedValue = (index, event) => {
    dispatchEditState({ type: "EDIT_COMMITTED_VALUE", index, price: event.target.value });
  };
  const getCurrentVoteCell = index => {
    // If this cell is currently being edited.
    if (editState[index]) {
      return (
        <TextField
          defaultValue={statusDetails[index].currentVote}
          onChange={event => editCommittedValue(index, event)}
        />
      );
    } else {
      return (
        <span>
          {statusDetails[index].currentVote}{" "}
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

  return (
    <div className={classes.root}>
      <Typography variant="h6" component="h6">
        Active Requests
      </Typography>
      <Table style={{ marginBottom: "10px" }}>
        <TableHead>
          <TableRow>
            <TableCell className={classes.tableHeaderCell}>Price Feed</TableCell>
            <TableCell className={classes.tableHeaderCell}>
              <Checkbox disabled />
            </TableCell>
            <TableCell className={classes.tableHeaderCell}>Timestamp</TableCell>
            <TableCell className={classes.tableHeaderCell}>Status</TableCell>
            <TableCell className={classes.tableHeaderCell}>Current Vote</TableCell>
          </TableRow>
        </TableHead>
        <TableBody className={classes.tableBody}>
          {pendingRequests.map((pendingRequest, index) => {
            return (
              <TableRow key={index}>
                <TableCell>{drizzle.web3.utils.hexToUtf8(pendingRequest.identifier)}</TableCell>
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
                <TableCell>{getCurrentVoteCell(index)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {revealButtonShown ? (
        <Button
          variant="contained"
          color="primary"
          disabled={hasPendingTransactions || !revealButtonEnabled}
          onClick={() => onClickHandler()}
        >
          Reveal selected
        </Button>
      ) : (
        ""
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
    </div>
  );
}

export default ActiveRequests;
