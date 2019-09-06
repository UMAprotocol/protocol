import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";
import { useSendGaPageview } from "lib/google-analytics";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import {
  useTextInput,
  useSendTransactionOnLink,
  useCollateralizationInformation,
  useMaxTokensThatCanBeCreated,
  useLiquidationPrice
} from "lib/custom-hooks";
import { createFormatFunction } from "common/FormattingUtils";

function Borrow(props) {
  const { tokenAddress } = props.match.params;
  useSendGaPageview("/Borrow");

  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei, hexToUtf8, toBN, toWei } = drizzle.web3.utils;

  const { amount: marginAmount, handleChangeAmount: handleChangeMarginAmount } = useTextInput();
  const { amount: tokenAmount, handleChangeAmount: handleChangeTokenAmount } = useTextInput();

  const { send, status } = useCacheSend(tokenAddress, "depositAndCreateTokens");
  const handleCreateClick = useSendTransactionOnLink({ send, status }, [marginAmount, tokenAmount], props.history);

  const data = useCollateralizationInformation(tokenAddress, "");
  const liquidationPrice = useLiquidationPrice(tokenAddress);
  data.updatedUnderlyingPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");
  const derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  const { ready, maxTokens } = useMaxTokensThatCanBeCreated(tokenAddress, marginAmount);
  if (!data.ready || !data.updatedUnderlyingPrice || !derivativeStorage || !ready) {
    return <div>Loading borrow data</div>;
  }

  const allowedToProceed = marginAmount !== "" && tokenAmount !== "" && toBN(toWei(tokenAmount)).lte(maxTokens);
  const isLoading = status === "pending";

  const format = createFormatFunction(drizzle.web3, 4);

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
                <dt>
                  Liquidation price [{hexToUtf8(derivativeStorage.fixedParameters.product)}]:{" "}
                  {liquidationPrice ? format(liquidationPrice) : "--"}
                </dt>
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
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Borrow);
