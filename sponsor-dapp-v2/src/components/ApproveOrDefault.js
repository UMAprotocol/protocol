import React from "react";

import classNames from "classnames";

import { useTokenPreapproval } from "lib/custom-hooks";

function ApproveOrDefault(props) {
  const { tokenContractName, addressToApprove, children } = props;
  const { ready, approveTokensHandler, isApproved, isLoadingApproval } = useTokenPreapproval(
    tokenContractName,
    addressToApprove
  );

  if (!ready || isApproved) {
    return children;
  } else {
    return (
      <a
        href="test"
        onClick={approveTokensHandler}
        className={classNames("btn has-loading", {
          disabled: false,
          "is-loading": isLoadingApproval
        })}
      >
        <div className="default-text">Approve Contract</div>

        <div className="loading-text">Processing</div>

        <div className="dot-pulse" />
      </a>
    );
  }
}

export default ApproveOrDefault;
