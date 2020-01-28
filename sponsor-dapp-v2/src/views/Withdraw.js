import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "@umaprotocol/react-plugin";
import { useSendGaPageview } from "lib/google-analytics";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { useTextInput, useSendTransactionOnLink, useCollateralizationInformation } from "lib/custom-hooks";

function Withdraw(props) {
  const { tokenAddress } = props.match.params;
  useSendGaPageview("/Withdraw");

  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei } = drizzle.web3.utils;

  const { amount: withdrawAmount, handleChangeAmount } = useTextInput();

  const { send, status } = useCacheSend(tokenAddress, "withdraw");
  const handleWithdrawClick = useSendTransactionOnLink({ send, status }, [withdrawAmount], props.history);

  const data = useCollateralizationInformation(
    tokenAddress,
    // If non-empty, `withdrawAmount` represents a negative `changeInShortBalance`.
    withdrawAmount !== "" ? "-" + withdrawAmount : withdrawAmount
  );
  if (!data.ready) {
    return <div>Loading withdraw data</div>;
  }

  // TODO(ptare): Determine the right set of conditions to allow proceeding.
  const allowedToProceed = withdrawAmount !== "";
  const isLoading = status === "pending";

  return (
    <div className="popup">
      <Header />

      <Link to={"/ManagePositions/" + tokenAddress} className="btn-close">
        <IconSvgComponent iconPath="svg/ico-close.svg" additionalClass="ico-close" />
      </Link>

      <div className="popup__inner">
        <div className="shell">
          <div className="popup__head">
            <h3>Withdraw collateral from facility</h3>

            <div className="popup__head-entry">
              <p>
                <strong>
                  Your facility has a {fromWei(data.collateralizationRequirement)}% collateralization requirement.
                </strong>{" "}
                You can withdraw collateral from your facility as long as you maintain this requirement.{" "}
              </p>
            </div>
          </div>

          <div className="popup__body">
            <div className="popup__col">
              <div className="form-group">
                <label htmlFor="field-withdraw" className="form__label">
                  Withdraw margin
                </label>

                <div className="form__controls">
                  <input
                    type="text"
                    className="field"
                    id="field-withdraw"
                    name="field-withdraw"
                    maxLength="18"
                    value={withdrawAmount}
                    onChange={e => handleChangeAmount(e)}
                    autoComplete="off"
                    disabled={isLoading}
                  />

                  <span>DAI</span>
                </div>
              </div>
            </div>

            <div className="popup__col">
              <div className="popup__entry">
                <p>
                  <strong>Facility collateralization</strong>
                </p>

                <ul>
                  <li>
                    <span>Current:</span>
                    <span>{data.currentCollateralization}</span>
                  </li>

                  <li className={classNames({ highlight: allowedToProceed })}>
                    <strong>New:</strong>
                    <span>{data.newCollateralizationAmount}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="popup__actions">
            <Link
              to={"/ManagePositions/" + tokenAddress}
              onClick={event => handleWithdrawClick(event)}
              className={classNames(
                "btn btn--size2 has-loading",
                { disabled: !allowedToProceed },
                { "is-loading": isLoading }
              )}
            >
              <span>Withdraw</span>

              <span className="loading-text">Processing</span>

              <strong className="dot-pulse" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Withdraw);
