import React, { Component } from "react";
import { Link } from "react-router-dom";

import classNames from "classnames";
import { CSSTransition } from "react-transition-group";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";

class Repay extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: false,
      tokens: "",
      showInfo: true,
      isLoadingInfo: false,
      isLoading: false
    };
  }

  checkProceeding = status => {
    this.setState({
      allowedToProceed: status
    });
  };

  handleChangeTokens(event) {
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
      this.setState({ tokens: event.target.value }, () => {
        this.checkFields();
      });
    }
  }

  checkFields() {
    if (this.state.tokens.length > 0) {
      this.checkProceeding(true);
    } else {
      this.checkProceeding(false);
    }
  }

  toggleInfo(e, state) {
    e.preventDefault();

    this.setState(
      {
        isLoadingInfo: true
      },
      () =>
        setTimeout(
          () =>
            this.setState({
              showInfo: state
            }),
          5000
        )
    );
  }

  delayRedirect = event => {
    const {
      history: { replace }
    } = this.props;
    event.preventDefault();

    const page = event.currentTarget.getAttribute("href");

    this.setState(
      {
        isLoading: true
      },
      () => setTimeout(() => replace(page), 5000)
    );
  };

  render() {
    return (
      <div className="popup">
        <Header />

        <Link to="/ManagePositions" className="btn-close">
          <IconSvgComponent iconPath="svg/ico-close.svg" additionalClass="ico-close" />
        </Link>

        <div className="popup__inner">
          <div className="shell">
            <div className="popup__head">
              <h3>Repay token debt</h3>
            </div>

            <div className="popup__body">
              <CSSTransition in={this.state.showInfo} timeout={300} classNames="step-1" unmountOnExit>
                <div className="popup__body-step">
                  <div className="popup__col">
                    <div className="popup__entry popup__entry-alt">
                      <p>
                        You must authorize your facility to redeem your tokens in exchange for DAI held in the smart
                        contract. This is standard across ERC-20 contracts and you will only have to do this once.
                      </p>
                    </div>

                    <div className="popup__actions">
                      <a
                        href="test"
                        className={classNames("btn btn--size2 has-loading", { "is-loading": this.state.isLoadingInfo })}
                        onClick={e => this.toggleInfo(e, false)}
                      >
                        <span>Authorize contract</span>

                        <span className="loading-text">Processing</span>

                        <strong className="dot-pulse"></strong>
                      </a>
                    </div>
                  </div>
                </div>
              </CSSTransition>

              <CSSTransition in={!this.state.showInfo} timeout={300} classNames="step-1" unmountOnExit>
                <div className="popup__body-step">
                  <div className="popup__col popup__col--offset-bottom">
                    <div className="form-group">
                      <label htmlFor="field-tokens" className="form__label">
                        How many tokens would you like to redeem?
                      </label>

                      <div className="form__controls">
                        <input
                          type="text"
                          className="field"
                          id="field-tokens"
                          name="field-tokens"
                          value={this.state.tokens}
                          maxLength="18"
                          autoComplete="off"
                          disabled={this.state.isLoading}
                          onChange={e => this.handleChangeTokens(e)}
                        />

                        <span>Tokens</span>
                      </div>

                      {this.state.allowedToProceed && (
                        <div className="form-hint">
                          <p>(Max 11)</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="popup__col popup__col--offset-bottom">
                    <div className="popup__entry">
                      <dl className="popup__description">
                        <dt>Redemption price [BTC/USD]: 14,000</dt>
                        <dd>Current price [BTC/USD]: 14,000 </dd>
                      </dl>

                      <dl className="popup__description">
                        <dt>Collateralization ratio: 112%</dt>
                        <dd>Minimum ratio: 110% </dd>
                      </dl>
                    </div>
                  </div>

                  <div className="popup__col">
                    <div className="popup__actions">
                      <Link
                        to="/ManagePositions"
                        onClick={event => this.delayRedirect(event)}
                        className={classNames(
                          "btn btn--size2 has-loading",
                          { disabled: !this.state.allowedToProceed },
                          { "is-loading": this.state.isLoading }
                        )}
                      >
                        <span>Repay token debt</span>

                        <span className="loading-text">Processing</span>

                        <strong className="dot-pulse"></strong>
                      </Link>
                    </div>
                  </div>
                </div>
              </CSSTransition>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default Repay;
