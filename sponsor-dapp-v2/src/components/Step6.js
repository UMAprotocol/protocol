import React from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";
import { createFormatFunction } from "common/FormattingUtils";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useIdentifierConfig, useEtherscanUrl } from "lib/custom-hooks";

function Step6(props) {
  // Grab functions to retrieve/compute displayed variables.
  const {
    drizzle: { web3 }
  } = drizzleReactHooks.useDrizzle();
  const format = createFormatFunction(web3, 4);
  const { toWei, toBN } = web3.utils;

  // Grab variables to display.
  const { identifier, contractAddress, tokensBorrowed } = props.userSelectionsRef.current;
  const etherscanUrl = useEtherscanUrl();
  const {
    [identifier]: { supportedMove }
  } = useIdentifierConfig();
  const collatReq = format(
    toBN(toWei(supportedMove))
      .add(toBN(toWei("1")))
      .muln(100)
  );

  return (
    <>
      <div className="step__content-alt">
        <p>
          You now own a custom token facility and {format(tokensBorrowed)} synthetic tokens tracking {identifier}! View
          token details on{" "}
          <a
            className="btn__link-default"
            href={`${etherscanUrl}address/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Etherscan.
          </a>
        </p>

        <p>
          <span>
            Synthetic tokens given you long exposure to {identifier}. Your token facility gives you short exposure.
          </span>
        </p>

        <p>
          <span>Maintain token facility collateralization greater than {collatReq}% to avoid liquidation.</span>
        </p>
      </div>

      <div className="step__aside">
        <div className="step__actions">
          <Link
            to="/ViewPositions"
            className={classNames("btn", {
              disabled: false
            })}
          >
            View my risk
          </Link>
        </div>
      </div>
    </>
  );
}

export default Step6;
