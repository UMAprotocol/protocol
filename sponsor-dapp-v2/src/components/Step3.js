import React, { Component } from "react";

import classNames from "classnames";

import IconSvgComponent from "components/common/IconSvgComponent";

class Step3 extends Component {
  constructor(props) {
    super(props);

    this.state = {
      allowedToProceed: true,
      isLoading: false,
      contractName: this.props.contractName,
      editingContractName: false,
      tokenSymbol: this.props.tokenSymbol,
      editingTokenSymbol: false
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

  editContractName = () => {
    this.setState({
      editingContractName: true
    });
  };

  saveContractName = event => {
    event.preventDefault();

    let val = this.refs.contractNameText.value;

    this.setState({
      contractName: val,
      editingContractName: false
    });
  };

  editTokenSymbol = () => {
    this.setState({
      editingTokenSymbol: true
    });
  };

  saveTokenSymbol = event => {
    event.preventDefault();

    let val = this.refs.tokenSymbolText.value;

    this.setState({
      tokenSymbol: val,
      editingTokenSymbol: false
    });
  };

  render() {
    return (
      <div className="step step--tertiary">
        <div className="step__content">
          <p>
            Launch token facility
            <span>Confirm the parameters of the token facility </span>
          </p>
        </div>

        <div className="step__aside">
          <div className="step__entry">
            <ul className="list-selections">
              <li>
                Assets: <span>{this.props.assets}</span>
              </li>

              <li>
                Collateralization requirement: <span>{this.props.requirement}</span>
              </li>

              <li>
                Expiry: <span>{this.props.expiry}</span>
              </li>

              <li>
                Contract name:
                {!this.state.editingContractName && (
                  <span className="text">
                    {this.state.contractName}

                    <button type="button" className="btn-edit" onClick={this.editContractName}>
                      <IconSvgComponent iconPath="svg/ico-edit.svg" additionalClass="ico-edit" />
                    </button>
                  </span>
                )}
                {this.state.editingContractName && (
                  <div className="form-edit">
                    <form action="#" method="post" onSubmit={e => this.saveContractName(e)}>
                      <div className="form__controls">
                        <input
                          type="text"
                          className="field"
                          ref="contractNameText"
                          defaultValue={this.state.contractName}
                        />
                      </div>

                      <div className="form__actions">
                        <button type="submit" className="form__btn">
                          <IconSvgComponent iconPath="svg/ico-check.svg" additionalClass="ico-check" />
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </li>

              <li>
                Token symbol:
                {!this.state.editingTokenSymbol && (
                  <span className="text">
                    {this.state.tokenSymbol}

                    <button type="button" className="btn-edit" onClick={this.editTokenSymbol}>
                      <IconSvgComponent iconPath="svg/ico-edit.svg" additionalClass="ico-edit" />
                    </button>
                  </span>
                )}
                {this.state.editingTokenSymbol && (
                  <div className="form-edit">
                    <form action="#" method="post" onSubmit={e => this.saveTokenSymbol(e)}>
                      <div className="form__controls">
                        <input
                          type="text"
                          className="field"
                          ref="tokenSymbolText"
                          defaultValue={this.state.tokenSymbol}
                        />
                      </div>

                      <div className="form__actions">
                        <button type="submit" className="form__btn">
                          <IconSvgComponent iconPath="svg/ico-check.svg" additionalClass="ico-check" />
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </li>
            </ul>
          </div>

          <div className="step__actions">
            <a href="test" className="btn btn--alt" onClick={this.props.onPrevStep}>
              Back
            </a>

            <a
              href="test"
              onClick={e => this.handleClick(e)}
              className={classNames("btn has-loading", {
                disabled: !this.state.allowedToProceed,
                "is-loading": this.state.isLoading
              })}
            >
              <span>Create Contract</span>

              <span className="loading-text">Processing</span>

              <strong className="dot-pulse" />
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default Step3;
