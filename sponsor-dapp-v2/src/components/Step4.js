import React, { useEffect } from "react";

import classNames from "classnames";
import { drizzleReactHooks } from "drizzle-react";

// Corresponds to `~uint(0)` in Solidity.
const UINT_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

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
    rawSend(addressToApprove, UINT_MAX);
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

  const render = () => {
    if (!send) {
      return <div />;
    }

    return (
      <div className="step">
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
      </div>
    );
  };
  return render();
}

export default Step4;
