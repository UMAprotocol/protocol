import React, { useEffect } from "react";

import classNames from "classnames";
import { drizzleReactHooks } from "drizzle-react";
import { MAX_UINT_VAL } from "common/Constants";

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
            (address: {contractAddress.slice(0, 2)}
            .....)
          </span>
        </p>

        <p>
          <span>
            In order to fund and borrow your tokens, you must authorize your new facility to accept DAI as the
            collateral. This is standard acrossERC-20 contracts and you will only have to do this once.{" "}
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
