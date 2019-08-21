import React, { Component } from "react";

import classNames from "classnames";

import Dropdown from "components/common/Dropdown";

class Step1 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: false,
      selectedIdentifier: null
    };

    this.dropdown = React.createRef();
  }

  checkProceeding = (status, selectedIdentifier) => {
    this.props.chosenIdentifierRef.current = selectedIdentifier;
    this.setState({
      allowedToProceed: status,
      selectedIdentifier: selectedIdentifier
    });
  };

  render() {
    const { identifierConfig } = this.props;

    const dropdownData = Object.keys(identifierConfig).map(identifier => {
      return {
        key: identifier,
        value: `${identifier} (${identifierConfig[identifier].collateralRequirement})`
      };
    });

    return (
      <div className="step step--primary">
        <div className="step__content">
          <p>
            Choose an asset
            <span>
              Select the synthetic asset that you’d like to borrow. Each synthetic asset has a different
              collateralization requirement (CR). DAI is used as collateral for borrowing synthetics.{" "}
            </span>
          </p>

          <p>
            <span>
              Want something else? <a href="mailto:hello@umaproject.org">Tell us</a>
            </span>
          </p>
        </div>

        <div className="step__aside">
          <div className="step__entry">
            <Dropdown
              ref={this.dropdown}
              placeholder="Select synthetic asset"
              list={dropdownData}
              onChange={this.checkProceeding}
              initialKeySelection={this.props.chosenIdentifierRef.current}
            />
          </div>

          <div className="step__actions">
            <a
              href="test"
              onClick={this.props.onNextStep}
              className={classNames("btn", {
                disabled: !this.state.allowedToProceed
              })}
            >
              Next
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default Step1;
