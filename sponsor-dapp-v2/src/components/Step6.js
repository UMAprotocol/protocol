import React from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";
import { createFormatFunction } from "common/FormattingUtils";
import { drizzleReactHooks } from "drizzle-react";
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
    <div className="step step--tertiary">
      <div className="step__content-alt">
        <p>
          You have successfully borrowed {format(tokensBorrowed)} synthetic tokens tracking {identifier}! View token
          details on{" "}
          <a href={`${etherscanUrl}address/${contractAddress}`} target="_blank" rel="noopener noreferrer">
            Etherscan.
          </a>
        </p>

        <p>
          <span>Sell these tokens to begin your levered short risk exposure.</span>
        </p>

        <p>
          <span>Maintain token facility collateralization greater than {collatReq}% to avoid liquidation.</span>
        </p>

        <p>
          <span>
            In order to take a position on the derivative you have create, you will need to Trade/Manage your position.
          </span>
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
    </div>
  );
}

export default Step6;
