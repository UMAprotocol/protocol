import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import classNames from "classnames";
import { CSSTransition } from "react-transition-group";

import { fetchAllSteps } from "store/state/steps/actions";

import IconSvgComponent from "components/common/IconSvgComponent";

import Header from "components/common/Header";
import Step1 from "components/Step1";
import Step2 from "components/Step2";
import Step3 from "components/Step3";
import Step4 from "components/Step4";
import Step5 from "components/Step5";
import Step6 from "components/Step6";

class Steps extends Component {
  state = {
    activeStepIndex: 0,
    steps: [
      {
        isActive: true,
        isCompleted: false
      },
      {
        isActive: false,
        isCompleted: false
      },
      {
        isActive: false,
        isCompleted: false
      },
      {
        isActive: false,
        isCompleted: false
      },
      {
        isActive: false,
        isCompleted: false
      }
    ]
  };

  nextStep(event) {
    event.preventDefault();
    const currentStepIndex = this.state.activeStepIndex;
    let nextStepIndex = currentStepIndex + 1;
    const stepsNav = [...this.state.steps];

    // If Last step, next Step index is the last one
    if (nextStepIndex === this.state.steps.length) {
      nextStepIndex = this.state.steps.length;
    } else {
      stepsNav[nextStepIndex].isActive = true;
    }

    stepsNav[currentStepIndex].isActive = false;
    stepsNav[currentStepIndex].isCompleted = true;

    if (currentStepIndex === 2 || currentStepIndex === 3 || currentStepIndex === 4) {
      setTimeout(() => {
        this.setState({
          activeStepIndex: nextStepIndex,
          steps: stepsNav
        });
      }, 5000);
    } else {
      this.setState({
        activeStepIndex: nextStepIndex,
        steps: stepsNav
      });
    }
  }

  prevStep(event) {
    event.preventDefault();
    const currentStepIndex = this.state.activeStepIndex;
    const prevStepIndex = currentStepIndex - 1;
    const stepsNav = [...this.state.steps];

    stepsNav[currentStepIndex].isActive = false;
    stepsNav[prevStepIndex].isActive = true;
    stepsNav[prevStepIndex].isCompleted = false;

    this.setState({
      activeStepIndex: prevStepIndex,
      steps: stepsNav
    });
  }

  componentDidMount() {
    this.props.fetchAllSteps();
  }

  render() {
    let { firstSteps } = this.props;
    let { lastSteps } = this.props;

    if (!firstSteps || !lastSteps) {
      return null;
    }

    return (
      <div className="steps">
        <Header />

        <Link to="/Start" className="btn-close">
          <IconSvgComponent iconPath="svg/ico-close.svg" additionalClass="ico-close" />
        </Link>

        <div className="steps__inner">
          <div className="shell">
            <div className="steps__head">
              <h2>Open a custom facility</h2>
            </div>

            <div className="steps__nav">
              <ul>
                {this.state.steps.map((item, index) => {
                  return (
                    <li
                      key={`item-${index}`}
                      className={classNames(
                        { "is-active": item.isActive },
                        {
                          "is-completed": item.isCompleted
                        }
                      )}
                    >
                      <span>{`0${index + 1}`}</span>

                      <span className="icon">
                        <IconSvgComponent iconPath="svg/ico-check.svg" additionalClass="ico-check" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="steps__body">
              <CSSTransition in={this.state.activeStepIndex === 0} timeout={300} classNames="step-1" unmountOnExit>
                <Step1 data={firstSteps} onNextStep={e => this.nextStep(e)} />
              </CSSTransition>

              <CSSTransition in={this.state.activeStepIndex === 1} timeout={300} classNames="step-2" unmountOnExit>
                <Step2 data={firstSteps} onNextStep={e => this.nextStep(e)} onPrevStep={e => this.prevStep(e)} />
              </CSSTransition>

              <CSSTransition in={this.state.activeStepIndex === 2} timeout={200} classNames="step-3" unmountOnExit>
                <Step3
                  assets="BTC/USD"
                  requirement="110%"
                  expiry="September 16, 2019 16:00:00 GMT"
                  contractName="BTCUSD_Sep19_0x1234"
                  tokenSymbol="BTC0x1234"
                  onNextStep={e => this.nextStep(e)}
                  onPrevStep={e => this.prevStep(e)}
                />
              </CSSTransition>

              <CSSTransition in={this.state.activeStepIndex === 3} timeout={200} classNames="step-4" unmountOnExit>
                <Step4 data={lastSteps} onNextStep={e => this.nextStep(e)} />
              </CSSTransition>

              <CSSTransition in={this.state.activeStepIndex === 4} timeout={300} classNames="step-5" unmountOnExit>
                <Step5 data={lastSteps} onNextStep={e => this.nextStep(e)} />
              </CSSTransition>

              <CSSTransition in={this.state.activeStepIndex === 5} timeout={300} classNames="step-6" unmountOnExit>
                <Step6 data={lastSteps} tokens="10" />
              </CSSTransition>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default connect(
  state => ({
    firstSteps: state.stepsData.firstSteps,
    lastSteps: state.stepsData.lastSteps
  }),
  {
    fetchAllSteps
  }
)(Steps);
