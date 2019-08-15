import React, { Component } from "react";

import classNames from "classnames";

class Step4 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: true,
      isLoading: false
    };
  }

  checkProceeding = status => {
    this.setState({
      allowedToProceed: status
    });
  };

  handleClick(event) {
    event.preventDefault();
    event.persist();

    this.setState(
      {
        isLoading: true
      },
      () => this.props.onNextStep(event)
    );
  }

  render() {
    const { data } = this.props;

    return (
      <div className="step">
        <div className="step__content">
          <p>
            Your token facility was successfully created.
            <span>
              (address: {data.tokenFacilityAddress.display.slice(0, 2)}
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
              onClick={e => this.handleClick(e)}
              className={classNames("btn has-loading", {
                disabled: !this.state.allowedToProceed,
                "is-loading": this.state.isLoading
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
  }
}

export default Step4;
