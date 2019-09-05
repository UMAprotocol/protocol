import React, { useEffect } from "react";

import classNames from "classnames";
import { drizzleReactHooks } from "drizzle-react";
import { MAX_UINT_VAL } from "common/Constants";
import { sendGaEvent } from "lib/google-analytics.js";

function useApproveDai(onSuccess, addressToApprove) {
  const { useCacheSend } = drizzleReactHooks.useDrizzle();

  const { send: rawSend, status } = useCacheSend("TestnetERC20", "approve");

  useEffect(() => {
    if (status === "success") {
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const send = () => {
    rawSend(addressToApprove, MAX_UINT_VAL);
    sendGaEvent("TestnetERC20", "approveMarginCurrency");
  };

  return { status, send };
}

function Step4(props) {
  const { contractAddress } = props.userSelectionsRef.current;

  const { status, send } = useApproveDai(props.onNextStep, contractAddress);

  const handleClick = event => {
    event.preventDefault();
    event.persist();

    // Send txn.
    send();
  };

  if (!send) {
    return <div />;
  }

  return (
    <>
      <div className="step__content">
        <p>
          Your token facility was successfully created.
          <span>
            (address: {contractAddress.slice(0, 6)}
            .....)
          </span>
        </p>

        <p>
          <span>
            To create tokens, you must authorize your new facility to accept DAI as collateral. This authorization is
            standard across ERC-20 contracts and you will only have to do this once.
          </span>
        </p>
      </div>

      <div className="step__aside">
        <div className="step__actions">
          <a
            href="test"
            onClick={e => handleClick(e)}
            className={classNames("btn has-loading", {
              disabled: false,
              "is-loading": status === "pending"
            })}
          >
            <span>Authorize contract</span>

            <span className="loading-text">Processing</span>

            <strong className="dot-pulse" />
          </a>
        </div>
      </div>
    </>
  );
}

export default Step4;
