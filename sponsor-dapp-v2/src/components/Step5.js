import React, { Component } from "react";

import classNames from "classnames";

class Step5 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: false,
      dai: "",
      tokens: "",
      isLoading: false
    };
  }

  checkProceeding = status => {
    this.setState({
      allowedToProceed: status
    });
  };

  handleChangeDai(event) {
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
      this.setState({ dai: event.target.value }, () => {
        this.checkFields();
      });
    }
  }

  handleChangeTokens(event) {
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
      this.setState({ tokens: event.target.value }, () => {
        this.checkFields();
      });
    }
  }

  checkFields() {
    if (this.state.dai.length > 0 && this.state.tokens.length > 0) {
      this.checkProceeding(true);
    } else {
      this.checkProceeding(false);
    }
  }

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
        <div className="form-borrow">
          <form action="#" method="post">
            <div className="form__body">
              <div className="form__row">
                <div className="form__col">
                  <div className="form-group">
                    <label htmlFor="field-dai" className="form__label">
                      How much Dai would you like to collateralize?
                    </label>

                    <div className="form__controls">
                      <input
                        type="text"
                        className="field"
                        id="field-dai"
                        name="field-dai"
                        value={this.state.dai}
                        maxLength="18"
                        autoComplete="off"
                        disabled={this.state.isLoading}
                        onChange={e => this.handleChangeDai(e)}
                      />

                      <span>DAI</span>
                    </div>
                  </div>
                </div>

                <div className="form__col">
                  <div className="form-group">
                    <label htmlFor="field-tokes" className="form__label">
                      How many synthetic tokens do you want to borrow?
                    </label>

                    <div className="form__controls">
                      <input
                        type="text"
                        id="field-tokes"
                        name="field-tokes"
                        className="field"
                        maxLength="18"
                        autoComplete="off"
                        disabled={this.state.isLoading}
                        value={this.state.tokens}
                        onChange={e => this.handleChangeTokens(e)}
                      />

                      <span>Tokens</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form__actions">
              <input type="submit" value="Submit" className="form__btn hidden" />
            </div>
          </form>
        </div>

        <div className="step__inner">
          <div className="step__content">
            <dl className="step__description">
              <dt>Liquidation price [{data.identifier}]: N/A</dt>
              <dd>
                Current price [{data.identifier}]: {data.currentPrice}
              </dd>
            </dl>

            <dl className="step__description">
              <dt>Collateralization ratio: N/A</dt>
              <dd>Minimum ratio: {data.minimumRatio}</dd>
            </dl>
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
                <span>Borrow tokens</span>

                <span className="loading-text">Processing</span>

                <strong className="dot-pulse" />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Step5;
