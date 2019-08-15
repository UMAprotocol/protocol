import React, { Component } from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";

class Step6 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: true
    };
  }

  checkProceeding = status => {
    this.setState({
      allowedToProceed: status
    });
  };

  render() {
    const { data } = this.props;

    return (
      <div className="step step--tertiary">
        <div className="step__content-alt">
          <p>
            You have successfully borrowed {this.props.tokens} synthetic tokens tracking {data.identifier}! View token
            details on{" "}
            <a href={data.tokenFacilityAddress.link} target="_blank" rel="noopener noreferrer">
              Etherscan.
            </a>
          </p>

          <p>
            <span>Sell these tokens to begin your levered short risk exposure.</span>
          </p>

          <p>
            <span>Maintain token facility collateralization greater than 110% to avoid liquidation.</span>
          </p>

          <p>
            <span>
              In order to take a position on the derivative you have create, you will need to Trade/Manage your
              position.
            </span>
          </p>
        </div>

        <div className="step__aside">
          <div className="step__actions">
            <Link
              to="/ViewPositions"
              className={classNames("btn", {
                disabled: !this.state.allowedToProceed
              })}
            >
              View my risk
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default Step6;
