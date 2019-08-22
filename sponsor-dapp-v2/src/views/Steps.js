import React, { useState, useMemo, useRef } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import classNames from "classnames";
import { CSSTransition } from "react-transition-group";
import { drizzleReactHooks } from "drizzle-react";

import IconSvgComponent from "components/common/IconSvgComponent";

import Header from "components/common/Header";
import Step1 from "components/Step1";
import Step2 from "components/Step2";
import Step3 from "components/Step3";
import Step4 from "components/Step4";
import Step5 from "components/Step5";
import Step6 from "components/Step6";

// TODO(mrice32): replace with some sort of global-ish config later.
function useIdentifierConfig() {
  return useMemo(
    () => ({
      "BTC/USD": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      },
      "ETH/USD": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      },
      "CoinMarketCap Top100 Index": {
        supportedMove: "0.2",
        collateralRequirement: "120%",
        expiries: [1568649600, 1571241600]
      },
      "S&P500": {
        supportedMove: "0.1",
        collateralRequirement: "110%",
        expiries: [1568649600, 1571241600]
      }
    }),
    []
  );
}

function useEnabledIdentifierConfig() {
  const {
    useCacheCallPromise,
    drizzle: { web3 }
  } = drizzleReactHooks.useDrizzle();
  const { useRerenderOnResolution } = drizzleReactHooks;

  const identifierConfig = useIdentifierConfig();

  // Note: using the promisified useCacheCall to prevent unrelated changes from triggering rerenders.
  const narrowedConfig = useCacheCallPromise(
    "NotApplicable",
    (callContract, resolvePromise, config) => {
      let finished = true;
      const call = (contractName, methodName, ...args) => {
        const result = callContract(contractName, methodName, ...args);
        if (result === undefined) {
          finished = false;
        }
        return result;
      };

      const narrowedConfig = {};
      for (const identifier in config) {
        if (
          call("Voting", "isIdentifierSupported", web3.utils.utf8ToHex(identifier)) &&
          call("ManualPriceFeed", "isIdentifierSupported", web3.utils.utf8ToHex(identifier))
        ) {
          narrowedConfig[identifier] = config[identifier];
        }
      }

      if (finished) {
        resolvePromise(narrowedConfig);
      }
    },
    identifierConfig
  );

  useRerenderOnResolution(narrowedConfig);

  return narrowedConfig.isResolved ? narrowedConfig.resolvedValue : undefined;
}

function Steps() {
  const identifierConfig = useEnabledIdentifierConfig();

  const chosenIdentifierRef = useRef(null);
  const chosenExpiryRef = useRef(null);

  const lastSteps = {
    tokenFacilityAddress: {
      display: "0x05d2BA4Ebc7ffaD147Fe266c573EFc885dB20109",
      link: "https://etherscan.io/address/0x05d2BA4Ebc7ffaD147Fe266c573EFc885dB20109"
    },
    collateralizationCurrency: {
      name: "Dai",
      symbol: "DAI"
    },
    identifier: "BTC/USD",
    currentPrice: "$14,000",
    minimumRatio: "110%"
  };

  const [state, setState] = useState({
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
  });

  const nextStep = event => {
    event.preventDefault();
    const currentStepIndex = state.activeStepIndex;
    let nextStepIndex = currentStepIndex + 1;
    const stepsNav = [...state.steps];

    // If Last step, next Step index is the last one
    if (nextStepIndex === state.steps.length) {
      nextStepIndex = state.steps.length;
    } else {
      stepsNav[nextStepIndex].isActive = true;
    }

    stepsNav[currentStepIndex].isActive = false;
    stepsNav[currentStepIndex].isCompleted = true;

    if (currentStepIndex === 2 || currentStepIndex === 3 || currentStepIndex === 4) {
      setTimeout(() => {
        setState(oldState => ({
          ...oldState,
          activeStepIndex: nextStepIndex,
          steps: stepsNav
        }));
      }, 5000);
    } else {
      setState(oldState => ({
        ...oldState,
        activeStepIndex: nextStepIndex,
        steps: stepsNav
      }));
    }
  };

  const prevStep = event => {
    event.preventDefault();
    const currentStepIndex = state.activeStepIndex;
    const prevStepIndex = currentStepIndex - 1;
    const stepsNav = [...state.steps];

    stepsNav[currentStepIndex].isActive = false;
    stepsNav[prevStepIndex].isActive = true;
    stepsNav[prevStepIndex].isCompleted = false;

    setState(oldState => ({
      ...oldState,
      activeStepIndex: prevStepIndex,
      steps: stepsNav
    }));
  };

  const render = () => {
    if (!identifierConfig || !lastSteps) {
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
                {state.steps.map((item, index) => {
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
              <CSSTransition in={state.activeStepIndex === 0} timeout={300} classNames="step-1" unmountOnExit>
                <Step1
                  identifierConfig={identifierConfig}
                  chosenIdentifierRef={chosenIdentifierRef}
                  onNextStep={e => nextStep(e)}
                />
              </CSSTransition>

              <CSSTransition in={state.activeStepIndex === 1} timeout={300} classNames="step-2" unmountOnExit>
                <Step2
                  identifierConfig={identifierConfig}
                  chosenIdentifier={chosenIdentifierRef.current}
                  chosenExpiryRef={chosenExpiryRef}
                  onNextStep={e => nextStep(e)}
                  onPrevStep={e => prevStep(e)}
                />
              </CSSTransition>

              <CSSTransition in={state.activeStepIndex === 2} timeout={200} classNames="step-3" unmountOnExit>
                <Step3
                  asset={chosenIdentifierRef.current}
                  requirement={
                    identifierConfig[chosenIdentifierRef.current] &&
                    identifierConfig[chosenIdentifierRef.current].supportedMove
                  }
                  expiry={chosenExpiryRef.current}
                  onNextStep={e => nextStep(e)}
                  onPrevStep={e => prevStep(e)}
                />
              </CSSTransition>

              <CSSTransition in={state.activeStepIndex === 3} timeout={200} classNames="step-4" unmountOnExit>
                <Step4 data={lastSteps} onNextStep={e => nextStep(e)} />
              </CSSTransition>

              <CSSTransition in={state.activeStepIndex === 4} timeout={300} classNames="step-5" unmountOnExit>
                <Step5 data={lastSteps} onNextStep={e => nextStep(e)} />
              </CSSTransition>

              <CSSTransition in={state.activeStepIndex === 5} timeout={300} classNames="step-6" unmountOnExit>
                <Step6 data={lastSteps} tokens="10" />
              </CSSTransition>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return render();
}

export default connect()(Steps);
