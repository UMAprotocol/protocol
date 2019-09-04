import React, { useState } from "react";

import moment from "moment";
import classNames from "classnames";

import Dropdown from "components/common/Dropdown";
import { useIdentifierConfig } from "lib/custom-hooks";

function Step2(props) {
  const [state, setState] = useState({
    allowedToProceed: false
  });

  const checkProceeding = (status, selectedExpiry) => {
    props.userSelectionsRef.current.expiry = selectedExpiry;
    setState({
      allowedToProceed: status
    });
  };

  const identifierConfig = useIdentifierConfig();

  if (!identifierConfig) {
    return null;
  }

  const {
    userSelectionsRef: { current: selection }
  } = props;

  const timeline = identifierConfig[selection.identifier].expiries.map(expiry => {
    return {
      key: expiry,
      value: moment.unix(expiry).format("MMMM DD, YYYY LTS")
    };
  });

  return (
    <div className="step step--secondary">
      <div className="step__content">
        <p>
          Choose token expiry
          <span>
            Choose the token’s final settlement date. <br />
            (you can repay early, too)
          </span>
        </p>
      </div>

      <div className="step__aside">
        <div className="step__entry">
          <Dropdown
            placeholder="Select settlement date"
            list={timeline}
            onChange={checkProceeding}
            initialKeySelection={selection.expiry}
          />
        </div>

        <div className="step__actions">
          <a href="test" className="btn btn--alt" onClick={props.onPrevStep}>
            Back
          </a>

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
    </div>
  );
}

export default Step2;
