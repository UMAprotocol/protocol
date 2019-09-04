import React, { useState } from "react";

import classNames from "classnames";
import web3 from "web3";

import Dropdown from "components/common/Dropdown";
import { useEnabledIdentifierConfig } from "lib/custom-hooks";
import { formatWei } from "common/FormattingUtils.js";

function Step1(props) {
  const [state, setState] = useState({
    allowedToProceed: false
  });

  const identifierConfig = useEnabledIdentifierConfig();

  const checkProceeding = (status, selectedIdentifier) => {
    props.userSelectionsRef.current.identifier = selectedIdentifier;
    setState({
      allowedToProceed: status
    });
  };

  if (!identifierConfig) {
    return null;
  }

  const { toBN, toWei } = web3.utils;

  const dropdownData = Object.keys(identifierConfig).map(identifier => {
    // Use BN rather than JS number to avoid precision issues.
    const collatReq = formatWei(
      toBN(toWei(identifierConfig[identifier].supportedMove))
        .add(toBN(toWei("1")))
        .muln(100),
      web3
    );
    return {
      key: identifier,
      value: `${identifier} (${collatReq}%)`
    };
  });

  return (
    <>
      <div className="step__content">
        <p>
          Customize your token
          <span>
            Select the price index that your token's value will track. Later, you can borrow synthetic tokens by
            collateralizing with DAI and maintaining a collateralization requirement (CR).
          </span>
        </p>

        <p>
          <span>
            Want something else? <a href="mailto:hello+pxrequests@umaproject.org">Tell us</a>
          </span>
        </p>
      </div>

      <div className="step__aside">
        <div className="step__entry">
          <Dropdown
            placeholder="Select a price index"
            list={dropdownData}
            onChange={checkProceeding}
            initialKeySelection={props.userSelectionsRef.current.identifier}
          />
        </div>

        <div className="step__actions">
          <a
            href="test"
            onClick={props.onNextStep}
            className={classNames("btn", {
              disabled: !state.allowedToProceed
            })}
          >
            Next
          </a>
        </div>
      </div>
    </>
  );
}

export default Step1;
