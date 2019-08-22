import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import classNames from "classnames";
import { CSSTransition } from "react-transition-group";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { useTextInput, useSendTransactionOnLink, useCollateralizationInformation } from "lib/custom-hooks";
import { createFormatFunction } from "common/FormattingUtils";
import { MAX_UINT_VAL } from "common/Constants";

function useTokenPreapproval(tokenAddress) {
  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { toBN } = drizzle.web3.utils;
  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const allowance = useCacheCall(tokenAddress, "allowance", account, tokenAddress);
  const allowanceAmount = toBN(MAX_UINT_VAL);
  const minAllowanceAmount = allowanceAmount.divRound(toBN("2"));
  const { send: approve, status: approvalStatus } = useCacheSend(tokenAddress, "approve");
  const approveTokensHandler = e => {
    e.preventDefault();
    approve(tokenAddress, allowanceAmount.toString(), { from: account });
  };

  if (!allowance) {
    return { ready: false };
  }

  return {
    ready: true,
    approveTokensHandler,
    isApproved: toBN(allowance).gte(minAllowanceAmount),
    isLoadingApproval: approvalStatus === "pending"
  };
}

function Repay(props) {
  const { tokenAddress } = props.match.params;

  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei } = drizzle.web3.utils;

  const { amount, handleChangeAmount } = useTextInput();
  const { send, status } = useCacheSend(tokenAddress, "redeemTokens");
  const handleRedeemClick = useSendTransactionOnLink({ send, status }, [amount], props.history);

  const data = useCollateralizationInformation(tokenAddress, "");
  data.updatedUnderlyingPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");
  data.tokenValue = useCacheCall(tokenAddress, "calcTokenValue");

  const { ready: approvalDataReady, approveTokensHandler, isApproved, isLoadingApproval } = useTokenPreapproval(
    tokenAddress
  );

  if (!data.ready || !data.updatedUnderlyingPrice || !approvalDataReady || !data.tokenValue) {
    return <div>Loading redeem data</div>;
  }

  const isLoadingRedeem = status === "pending";
  const allowedToProceed = amount !== "";

  const format = createFormatFunction(drizzle.web3, 4);

  // TODO(ptare): Add back help text containing max tokens that can be redeemed (and enable/disable the button
  // accordingly).
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
              <h3>Repay token debt</h3>
            </div>

            <div className="popup__body">
              <CSSTransition in={!isApproved} timeout={300} classNames="step-1" unmountOnExit>
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
                        href="should-never-trigger"
                        className={classNames("btn btn--size2 has-loading", { "is-loading": isLoadingApproval })}
                        onClick={e => approveTokensHandler(e)}
                      >
                        <span>Authorize contract</span>

                        <span className="loading-text">Processing</span>

                        <strong className="dot-pulse" />
                      </a>
                    </div>
                  </div>
                </div>
              </CSSTransition>

              <CSSTransition in={isApproved} timeout={300} classNames="step-1" unmountOnExit>
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
                          value={amount}
                          maxLength="18"
                          autoComplete="off"
                          disabled={isLoadingRedeem}
                          onChange={e => handleChangeAmount(e)}
                        />

                        <span>Tokens</span>
                      </div>
                    </div>
                  </div>

                  <div className="popup__col popup__col--offset-bottom">
                    <div className="popup__entry">
                      <dl className="popup__description">
                        <dt>Redemption price: {format(data.tokenValue)}</dt>
                        <dd>Current price: {format(data.updatedUnderlyingPrice.underlyingPrice)}</dd>
                      </dl>

                      <dl className="popup__description">
                        <dt>Collateralization ratio: {data.currentCollateralization}</dt>
                        <dd>Minimum ratio: {fromWei(data.collateralizationRequirement)}% </dd>
                      </dl>
                    </div>
                  </div>

                  <div className="popup__col">
                    <div className="popup__actions">
                      <Link
                        to={"/ManagePositions/" + tokenAddress}
                        onClick={event => handleRedeemClick(event)}
                        className={classNames(
                          "btn btn--size2 has-loading",
                          { disabled: !allowedToProceed },
                          { "is-loading": isLoadingRedeem }
                        )}
                      >
                        <span>Repay token debt</span>

                        <span className="loading-text">Processing</span>

                        <strong className="dot-pulse" />
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
  };
  return render();
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Repay);
