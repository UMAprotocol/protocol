import React, { Component } from "react";

import moment from "moment";
import classNames from "classnames";

import Dropdown from "components/common/Dropdown";

class Step2 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: false
    };

    this.dropdown = React.createRef();
  }

  checkProceeding = status => {
    this.setState({
      allowedToProceed: status
    });
  };

  render() {
    const { data } = this.props;

    const timeline = data.expiries.map(expiry => {
      return moment.unix(expiry.unixTimestamp).format("MMMM DD, YYYY LTS");
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
              ref={this.dropdown}
              placeholder="Select settlement date"
              list={timeline}
              onChange={this.checkProceeding}
            />
          </div>

          <div className="step__actions">
            <a href="test" className="btn btn--alt" onClick={this.props.onPrevStep}>
              Back
            </a>

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

export default Step2;
