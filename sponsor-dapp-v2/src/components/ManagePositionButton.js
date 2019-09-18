import React from "react";

import classNames from "classnames";

import { useTokenPreapproval, useSettle, useExpire, useIsContractSponsor } from "lib/custom-hooks";

function ManagePositionButton(props) {
  const { contractAddress, identifier, history } = props;

  const { ready: approveReady, approveTokensHandler, isApproved, isLoadingApproval } = useTokenPreapproval(
    "TestnetERC20",
    contractAddress
  );

  const { ready: settleReady, canCallSettle, settleHandler, isLoadingSettle } = useSettle(contractAddress);
  const { ready: expireReady, canCallExpire, expireHandler, isLoadingExpire } = useExpire(contractAddress, identifier);
  const isContractSponsor = useIsContractSponsor(contractAddress);
  const ready = approveReady && settleReady && expireReady && isContractSponsor !== undefined;

  if (!ready) {
    return (
      <a
        href="test"
        className={classNames("btn", {
          disabled: true
        })}
      >
        Loading
      </a>
    );
  }

  let buttonDetails;

  if (canCallSettle) {
    buttonDetails = {
      disabled: false,
      isLoading: isLoadingSettle,
      text: "Settle Contract",
      handler: settleHandler
    };
  } else if (canCallExpire) {
    buttonDetails = {
      disabled: false,
      isLoading: isLoadingExpire,
      text: "Expire Contract",
      handler: expireHandler
    };
  } else if (isContractSponsor && !isApproved) {
    buttonDetails = {
      disabled: false,
      isLoading: isLoadingApproval,
      text: "Approve Contract",
      handler: approveTokensHandler
    };
  } else {
    const managePositionHandler = e => {
      e.preventDefault();
      history.push("/ManagePositions/" + contractAddress);
    };

    buttonDetails = {
      disabled: false,
      isLoading: false,
      text: "Manage Position",
      handler: managePositionHandler
    };
  }

  return (
    <a
      href="test"
      onClick={buttonDetails.handler}
      className={classNames("btn has-loading", {
        disabled: buttonDetails.disabled,
        "is-loading": buttonDetails.isLoading
      })}
    >
      <div className="default-text">{buttonDetails.text}</div>

      <div className="loading-text">Processing</div>

      <div className="dot-pulse" />
    </a>
  );
}

export default ManagePositionButton;
