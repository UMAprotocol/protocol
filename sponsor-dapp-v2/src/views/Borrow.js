import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { useTextInput, useSendTransactionOnLink, useCollateralizationInformation } from "lib/custom-hooks";
import { createFormatFunction } from "common/FormattingUtils";

function useMaxTokensThatCanBeCreated(tokenAddress, marginAmount) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { toWei, toBN } = drizzle.web3.utils;

  const derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  const newExcessMargin = useCacheCall(tokenAddress, "calcExcessMargin");
  const tokenValue = useCacheCall(tokenAddress, "calcTokenValue");

  const dataFetched = derivativeStorage && newExcessMargin && tokenValue;
  if (!dataFetched) {
    return { ready: false };
  }
  if (marginAmount === "") {
    return { ready: true, maxTokens: toBN("0") };
  }

  const fpScalingFactor = toBN(toWei("1"));
  const sentAmount = toBN(toWei(marginAmount));
  const supportedMove = toBN(derivativeStorage.fixedParameters.supportedMove);
  const tokenValueBn = toBN(tokenValue);

  const mul = (a, b) => a.mul(b).divRound(fpScalingFactor);
  const div = (a, b) => a.mul(fpScalingFactor).divRound(b);

  // `supportedTokenMarketCap` represents the extra token market cap that there is sufficient collateral for. Tokens can be purchased at
  // `tokenValue` up to this amount.
  const supportedTokenMarketCap = div(toBN(newExcessMargin), supportedMove);
  if (sentAmount.lte(supportedTokenMarketCap)) {
    // The amount of money being sent in is the limiting factor.
    return { ready: true, maxTokens: div(sentAmount, tokenValueBn) };
  } else {
    // Tokens purchased beyond the value of `supportedTokenMarketCap` cost `(1 + supportedMove) * tokenValue`, because some of
    // the money has to be diverted to support the margin requirement.
    const costOfExtra = mul(tokenValueBn, fpScalingFactor.add(supportedMove));
    const extra = sentAmount.sub(supportedTokenMarketCap);
    return { ready: true, maxTokens: div(supportedTokenMarketCap, tokenValueBn).add(div(extra, costOfExtra)) };
  }
}

function Borrow(props) {
  const { tokenAddress } = props.match.params;

  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei, toBN, toWei } = drizzle.web3.utils;

  const { amount: marginAmount, handleChangeAmount: handleChangeMarginAmount } = useTextInput();
  const { amount: tokenAmount, handleChangeAmount: handleChangeTokenAmount } = useTextInput();

  const { send, status } = useCacheSend(tokenAddress, "depositAndCreateTokens");
  const handleCreateClick = useSendTransactionOnLink({ send, status }, [marginAmount, tokenAmount], props.history);

  const data = useCollateralizationInformation(tokenAddress, "");
  data.updatedUnderlyingPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");
  const { ready, maxTokens } = useMaxTokensThatCanBeCreated(tokenAddress, marginAmount);
  if (!data.ready || !data.updatedUnderlyingPrice || !ready) {
    return <div>Loading borrow data</div>;
  }

  const allowedToProceed = marginAmount !== "" && tokenAmount !== "" && toBN(toWei(tokenAmount)).lte(maxTokens);
  const isLoading = status === "pending";

  const format = createFormatFunction(drizzle.web3, 4);

  const render = () => {
    return (
      <div className="popup">
        <Header />

        <Link to={"/ManagePositions/" + tokenAddress} className="btn-close">
          <IconSvgComponent iconPath="svg/ico-close.svg" additionalClass="ico-close" />
        </Link>

        <div className="popup__inner">
          <div className="shell">
            <div className="popup__head">
              <h3>Borrow additional tokens</h3>
            </div>

            <div className="popup__body">
              <div className="popup__col popup__col--offset-bottom">
                <div className="form-group">
                  <label htmlFor="field-borrow" className="form__label">
                    How much Dai would you like to collateralize?
                  </label>

                  <div className="form__controls">
                    <input
                      type="text"
                      className="field"
                      id="field-borrow"
                      name="field-borrow"
                      value={marginAmount}
                      maxLength="18"
                      autoComplete="off"
                      disabled={isLoading}
                      onChange={e => handleChangeMarginAmount(e)}
                    />

                    <span>DAI</span>
                  </div>
                </div>
              </div>

              <div className="popup__col popup__col--offset-bottom">
                <div className="form-group">
                  <label htmlFor="field-tokens" className="form__label">
                    How many synthetic tokens do you want to borrow?
                  </label>

                  <div className="form__controls">
                    <input
                      type="text"
                      className="field"
                      id="field-tokens"
                      name="field-tokens"
                      value={tokenAmount}
                      maxLength="18"
                      autoComplete="off"
                      disabled={isLoading}
                      onChange={e => handleChangeTokenAmount(e)}
                    />

                    <span>Tokens</span>
                  </div>

                  {tokenAmount !== "" && marginAmount !== "" && (
                    <div className="form-hint">
                      <p>(Max {format(maxTokens)})</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="popup__col">
                <dl className="popup__description">
                  <dt>Liquidation price [BTC/USD]: 15,400</dt>
                  <dd>Current price: {format(data.updatedUnderlyingPrice.underlyingPrice)} </dd>
                </dl>

                <dl className="popup__description">
                  <dt>Collateralization ratio: {data.currentCollateralization}</dt>
                  <dd>Minimum ratio: {fromWei(data.collateralizationRequirement)}%</dd>
                </dl>
              </div>

              <div className="popup__col">
                <div className="popup__actions">
                  <Link
                    to={"/ManagePositions/" + tokenAddress}
                    onClick={event => handleCreateClick(event)}
                    className={classNames(
                      "btn btn--block has-loading",
                      { disabled: !allowedToProceed },
                      { "is-loading": isLoading }
                    )}
                  >
                    <span>Collateralize & borrow tokens</span>

                    <span className="loading-text">Processing</span>

                    <strong className="dot-pulse" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };
  return render();
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Borrow);
