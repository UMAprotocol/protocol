import React, { useEffect } from "react";

import classNames from "classnames";
import { withAddedContract } from "lib/contracts";
import {
  useTextInput,
  useCollateralizationInformation,
  useMaxTokensThatCanBeCreated,
  useLiquidationPrice
} from "lib/custom-hooks";
import { drizzleReactHooks } from "drizzle-react";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { createFormatFunction } from "common/FormattingUtils";

function useBorrow(onSuccess, userSelectionsRef, ...args) {
  const { useCacheSend, drizzle } = drizzleReactHooks.useDrizzle();
  const { toWei } = drizzle.web3.utils;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const { send: rawSend, status, TXObjects } = useCacheSend(
    userSelectionsRef.current.contractAddress,
    "depositAndCreateTokens"
  );

  useEffect(() => {
    if (status === "success") {
      // Save the number of tokens that the user borrowed so it can be displayed on the next page.
      userSelectionsRef.current.tokensBorrowed =
        TXObjects[TXObjects.length - 1].receipt.events.TokensCreated.returnValues.numTokensCreated;
      onSuccess();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const send = () => {
    rawSend(...args.map(amount => toWei(amount)), { from: account });
  };

  return { status, send };
}

function Step5(props) {
  // Pull in relevant functions.
  const { useCacheCall, drizzle } = drizzleReactHooks.useDrizzle();
  const format = createFormatFunction(drizzle.web3, 4);

  // Get user inputs.
  const { amount: dai, handleChangeAmount: handleChangeDai } = useTextInput();
  const { amount: tokens, handleChangeAmount: handleChangeTokens } = useTextInput();
  const { identifier, contractAddress } = props.userSelectionsRef.current;

  // Set up potential txn.
  const { send, status } = useBorrow(props.onNextStep, props.userSelectionsRef, dai, tokens);

  // Get data to display.
  const { currentCollateralization, collateralizationRequirement } = useCollateralizationInformation(
    contractAddress,
    ""
  );
  const currentPrice = useCacheCall(contractAddress, "getUpdatedUnderlyingPrice");
  const liquidationPrice = useLiquidationPrice(contractAddress);

  const { ready, maxTokens } = useMaxTokensThatCanBeCreated(contractAddress, dai);

  const handleClick = event => {
    event.preventDefault();
    event.persist();

    // Send txn.
    send();
  };

  const allowedToProceed = dai !== "" && tokens !== "";

  return (
    <div className="step step-5-enter-done">
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
                      value={dai}
                      maxLength="18"
                      autoComplete="off"
                      disabled={status === "pending"}
                      onChange={e => handleChangeDai(e)}
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
                      disabled={status === "pending"}
                      value={tokens}
                      onChange={e => handleChangeTokens(e)}
                    />
                    <span>Tokens</span>
                  </div>

                  {tokens !== "" && dai !== "" && ready && (
                    <div className="form-hint">
                      <p>(Max {format(maxTokens)})</p>
                    </div>
                  )}
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
            <dt>
              Liquidation price [{identifier}]: {liquidationPrice ? format(liquidationPrice) : "--"}
            </dt>
            <dd>
              Current price [{identifier}]: ${currentPrice ? format(currentPrice.underlyingPrice) : " --"}
            </dd>
          </dl>

          <dl className="step__description">
            <dt>Collateralization ratio: {currentCollateralization || "-- %"}</dt>
            <dd>Minimum ratio: {collateralizationRequirement ? format(collateralizationRequirement) : "-- %"}%</dd>
          </dl>
        </div>

        <div className="step__aside">
          <div className="step__actions">
            <a
              href="test"
              onClick={e => handleClick(e)}
              className={classNames("btn has-loading", {
                disabled: !allowedToProceed,
                "is-loading": status === "pending"
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

export default withAddedContract(TokenizedDerivative.abi, props => props.userSelectionsRef.current.contractAddress)(
  Step5
);
