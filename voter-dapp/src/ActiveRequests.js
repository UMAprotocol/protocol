import React, { useEffect, useMemo, useState, useReducer, useRef } from "react";
import Button from "@material-ui/core/Button";
import Checkbox from "@material-ui/core/Checkbox";
import * as drizzleReactHooksPromise from "./hooks";
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
import { createExpandedPromise } from "./hooks/ExpandedPromise.js";
import useRerenderOnResolution from "./hooks/RerenderOnResolution.js";
const { getKeyGenMessage } = require("./common/EncryptionHelper.js");

const editStateReducer = (state, action) => {
  switch (action.type) {
    case "EDIT_COMMIT":
      return { ...state, [action.index]: action.price ? action.price : "0" };
    case "EDIT_COMMITTED_VALUE":
      return { ...state, [action.index]: action.price };
    case "SUBMIT_COMMIT":
      const newValues = state;
      for (const index in action.indicesCommitted) {
        newValues[index] = undefined;
      }
      return newValues;
    default:
      throw new Error();
  }
};

function ActiveRequests() {
  const { drizzle, useCacheCallPromise, useCacheEventsPromise } = drizzleReactHooksPromise.useDrizzle();
  const { useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const classes = useTableStyles();

  const [checkboxesChecked, setCheckboxesChecked] = useState({});
  const check = (index, event) => {
    setCheckboxesChecked(old => ({ ...old, [index]: event.target.checked }));
  };

  const pendingRequests = useCacheCallPromise("Voting", "getPendingRequests");
  const currentRoundId = useCacheCallPromise("Voting", "getCurrentRoundId");
  const votePhase = useCacheCallPromise("Voting", "getVotePhase");
  const account = drizzleReactHooksPromise.useDrizzleStatePromise((drizzleState, resolvePromise) => {
    if (drizzleState.accounts[0]) {
      resolvePromise(drizzleState.accounts[0]);
    }
  });

  const revealEvents = useCacheEventsPromise(
    "Voting",
    "VoteRevealed",
    useMemo(
      () => (accountResolved, currentRoundIdResolved) => ({
        filter: { voter: accountResolved, roundId: currentRoundIdResolved },
        fromBlock: 0
      }),
      []
    ),
    useMemo(() => [account, currentRoundId], [account, currentRoundId])
  );

  const voteStatuses = useCacheCallPromise(
    ["Voting"],
    (call, resolvePromise, accountResolved, currentRoundIdResolved, pendingRequestsResolved, votePhaseResolved) => {
      let allRequestsDone = true;
      const voteStatuses = [];
      for (const request of pendingRequestsResolved) {
        const voteStatus = {
          committedValue: call(
            "Voting",
            "getMessage",
            accountResolved,
            web3.utils.soliditySha3(request.identifier, request.time, currentRoundIdResolved)
          ),
          hasRevealed:
            votePhaseResolved.toString() === VotePhasesEnum.REVEAL
              ? call("Voting", "hasRevealedVote", request.identifier, request.time)
              : false
        };

        allRequestsDone =
          allRequestsDone && voteStatus.committedValue !== undefined && voteStatus.hasRevealed !== undefined;

        voteStatuses.push(voteStatus);
      }

      if (allRequestsDone) {
        resolvePromise(voteStatuses);
      }
    },
    account,
    currentRoundId,
    pendingRequests,
    votePhase
  );

  const [decryptionKey, setDecryptionKey] = useState(createExpandedPromise());
  const decryptionKeysCache = useRef({});
  useEffect(() => {
    async function getDecryptionKey() {
      // Wait for the account and current round id to finish resolving before continuing.
      const accountResolved = await account;
      const currentRoundIdResolved = await currentRoundId;

      // Check the cache for an existing key.
      if (decryptionKeysCache.current[accountResolved]) {
        // If the cached key already exists return it.
        const cachedKey = decryptionKeysCache.current[accountResolved][currentRoundIdResolved];
        if (cachedKey) {
          return cachedKey;
        }
      } else {
        // If no object has been created for this account yet, create it.
        decryptionKeysCache.current[accountResolved] = {};
      }

      // TODO(ptare): Handle the user refusing to sign the message.
      const { privateKey, publicKey } = await deriveKeyPairFromSignatureMetamask(
        web3,
        getKeyGenMessage(currentRoundIdResolved),
        accountResolved
      );

      decryptionKeysCache.current[accountResolved][currentRoundIdResolved] = { privateKey, publicKey };

      return { privateKey, publicKey };
    }

    // Each time this runs, we want to create a new promise.
    const decryptionKeyPromise = createExpandedPromise();

    // Resolve the promise with the result of the getDecryptionKey method.
    getDecryptionKey(decryptionKeyPromise).then(decryptionKey => {
      decryptionKeyPromise.resolve(decryptionKey);
    });

    setDecryptionKey(decryptionKeyPromise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentRoundId]);

  const [decryptedCommits, setDecryptedCommits] = useState(createExpandedPromise());
  useEffect(() => {
    async function decryptAll() {
      // Unpack all required data before doing the operation.
      const voteStatusesResolved = await voteStatuses;
      const decryptionKeyResolved = await decryptionKey;

      const currentVotes = await Promise.all(
        voteStatusesResolved.map(async (voteStatus, index) => {
          if (voteStatus.committedValue) {
            return JSON.parse(await decryptMessage(decryptionKeyResolved.privateKey, voteStatus.committedValue));
          } else {
            return "";
          }
        })
      );

      return currentVotes;
    }

    // Create a fresh promise each time the method is run.
    const decryptedCommitsPromise = createExpandedPromise();

    // Resolve the promise once the decryption operation returns.
    decryptAll().then(currentVotes => {
      decryptedCommitsPromise.resolve(currentVotes);
    });

    // Overwrite the state variable with the new promise.
    setDecryptedCommits(decryptedCommitsPromise);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteStatuses, decryptionKey]);

  // Triggers a rerender when the commit decryption finishes since it's the last step in the data pull staging.
  useRerenderOnResolution(decryptedCommits);

  const { send: batchRevealFunction, status: revealStatus } = useCacheSend("Voting", "batchReveal");
  const onClickHandler = async () => {
    const pendingRequestsResolved = await pendingRequests;
    const decryptedCommitsResolved = await decryptedCommits;
    const reveals = [];
    for (const index in checkboxesChecked) {
      if (checkboxesChecked[index]) {
        reveals.push({
          identifier: pendingRequests[index].identifier,
          time: pendingRequestsResolved[index].time,
          price: decryptedCommitsResolved[index].price.toString(),
          salt: web3.utils.hexToNumberString(decryptedCommitsResolved[index].salt)
        });
      }
    }
    batchRevealFunction(reveals);
    setCheckboxesChecked({});
  };

  const [editState, dispatchEditState] = useReducer(editStateReducer, {});

  const { send: batchCommitFunction, status: commitStatus } = useCacheSend("Voting", "batchCommit");
  const onSaveHandler = async () => {
    const decryptionKeyResolved = await decryptionKey;
    const pendingRequestsResolved = await pendingRequests;

    const commits = [];
    const indicesCommitted = [];
    for (const index in editState) {
      if (!checkboxesChecked[index] || !editState[index]) {
        continue;
      }
      const price = web3.utils.toWei(editState[index]);
      const salt = web3.utils.toBN(web3.utils.randomHex(32));
      const encryptedVote = await encryptMessage(decryptionKeyResolved.publicKey, JSON.stringify({ price, salt }));
      commits.push({
        identifier: pendingRequestsResolved[index].identifier,
        time: pendingRequestsResolved[index].time,
        hash: web3.utils.soliditySha3(price, salt),
        encryptedVote
      });
      indicesCommitted.push(index);
    }
    if (commits.length < 1) {
      return;
    }
    batchCommitFunction(commits);
    setCheckboxesChecked({});
    dispatchEditState({ type: "SUBMIT_COMMIT", indicesCommitted });
  };

  // NOTE: No calls to React hooks from this point forward.
  if (
    !pendingRequests.isResolved ||
    !currentRoundId.isResolved ||
    !votePhase.isResolved ||
    !account.isResolved ||
    !revealEvents.isResolved ||
    !voteStatuses.isResolved ||
    !decryptionKey.isResolved ||
    !decryptedCommits.isResolved
  ) {
    return <div>Looking up requests</div>;
  }

  const toPriceRequestKey = (identifier, time) => time + "," + identifier;
  const eventsMap = {};
  for (const reveal of revealEvents.resolvedValue) {
    eventsMap[toPriceRequestKey(reveal.returnValues.identifier, reveal.returnValues.time)] = formatWei(
      reveal.returnValues.price,
      web3
    );
  }

  const hasPendingTransactions = revealStatus === "pending" || commitStatus === "pending";
  const statusDetails = voteStatuses.resolvedValue.map((voteStatus, index) => {
    let currentVote = "";
    if (voteStatus.committedValue && decryptedCommits.resolvedValue[index].price) {
      currentVote = formatWei(decryptedCommits.resolvedValue[index].price, web3);
    }
    if (votePhase.resolvedValue.toString() === VotePhasesEnum.COMMIT) {
      return {
        statusString: "Commit",
        currentVote: currentVote,
        enabled: editState[index] && !hasPendingTransactions
      };
    }
    // In the REVEAL phase.
    if (voteStatus.hasRevealed) {
      const pendingRequest = pendingRequests.resolvedValue[index];
      return {
        statusString: "Revealed",
        currentVote: eventsMap[toPriceRequestKey(pendingRequest.identifier, pendingRequest.time)],
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
  const revealButtonShown = votePhase.resolvedValue.toString() === VotePhasesEnum.REVEAL;
  const revealButtonEnabled = statusDetails.some(statusDetail => statusDetail.enabled);
  const saveButtonShown = votePhase.resolvedValue.toString() === VotePhasesEnum.COMMIT;
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
          {pendingRequests.resolvedValue.map((pendingRequest, index) => {
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
