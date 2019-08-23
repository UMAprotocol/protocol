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
  const updatedPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");
  const tokenValue = useCacheCall(tokenAddress, "calcTokenValue");

  const dataFetched = derivativeStorage && newExcessMargin && updatedPrice && tokenValue;
  if (!dataFetched || marginAmount === "") {
    return false;
  }

  const fpScalingFactor = toBN(toWei("1"));
  // NOTE: I have very little faith in the calculation performed below.
  // NOTE: Does not take leverage into account.
  // The amount of margin sent in (`marginAmount`) can be allocated to either purchase new tokens (go to long margin)
  // or to satisfy margin requirements to support new tokens (go to short margin).

  // Every additional amount of margin allows us to purchase this many new tokens.
  const purchaseLimitScalingFactor = fpScalingFactor.mul(fpScalingFactor).divRound(toBN(tokenValue));
  // Every additional amount of margin allows us to support margin requirements for this many new tokens.
  const marginLimitScalingFactor = fpScalingFactor
    .mul(fpScalingFactor)
    .mul(fpScalingFactor)
    .mul(fpScalingFactor)
    .divRound(toBN(derivativeStorage.fixedParameters.initialTokenUnderlyingRatio))
    .divRound(toBN(updatedPrice.underlyingPrice))
    .divRound(toBN(derivativeStorage.fixedParameters.supportedMove));

  // `purchaseLimit` represents how many tokens could be purchased if all the sent margin was allocated to purchasing
  // tokens. Note that the contract doesn't currently allow purchasing tokens via this method call by drawing down on
  // excess short margin.
  const purchaseLimit = toBN(toWei(marginAmount))
    .mul(purchaseLimitScalingFactor)
    .divRound(fpScalingFactor);
  // `marginLimit` represents how many extra tokens the current excess margin can support.
  const marginLimit = toBN(newExcessMargin)
    .mul(marginLimitScalingFactor)
    .divRound(fpScalingFactor);
  // The following two statements handle the case where some amount of the sent margin must be allocated to increasing
  // short margin.
  const additionalAllocation = purchaseLimit
    .sub(marginLimit)
    .abs()
    .mul(fpScalingFactor)
    .divRound(purchaseLimitScalingFactor.add(marginLimitScalingFactor));
  const limit = purchaseLimit.lte(marginLimit)
    ? purchaseLimit
    : marginLimit.add(additionalAllocation.mul(marginLimitScalingFactor).div(fpScalingFactor));

  // The contract doesn't allow the sponsor to escape default and create tokens at once: they have to first
  // deposit and then create. I.e., a negative `marginLimit` means that remargining would default the contract.
  return marginLimit.isNeg() ? toBN("0") : limit;
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
  const maxTokensThatCanBeCreated = useMaxTokensThatCanBeCreated(tokenAddress, marginAmount);
  if (!data.ready || !data.updatedUnderlyingPrice || !maxTokensThatCanBeCreated) {
    return <div>Loading borrow data</div>;
  }

  const allowedToProceed =
    marginAmount !== "" && tokenAmount !== "" && toBN(toWei(tokenAmount)).lte(maxTokensThatCanBeCreated);
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
                      <p>(Max {format(maxTokensThatCanBeCreated)})</p>
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
