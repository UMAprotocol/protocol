import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { useTextInput, useSendTransactionOnLink, useCollateralizationInformation } from "lib/custom-hooks";

function Deposit(props) {
  const { tokenAddress } = props.match.params;

  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei } = drizzle.web3.utils;

  const { amount: depositAmount, handleChangeAmount } = useTextInput();

  const { send, status } = useCacheSend(tokenAddress, "deposit");
  const handleDepositClick = useSendTransactionOnLink({ send, status }, depositAmount, props.history);

  const data = useCollateralizationInformation(tokenAddress, depositAmount);
  if (!data.ready) {
    return <div>Loading deposit data</div>;
  }

  // TODO(ptare): Determine the right set of conditions to allow proceeding.
  const allowedToProceed = depositAmount !== "";
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
            <h3>Deposit additional collateral in facility</h3>

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
                  Add additional margin
                </label>

                <div className="form__controls">
                  <input
                    type="text"
                    className="field"
                    id="field-withdraw"
                    name="field-withdraw"
                    maxLength="18"
                    autoComplete="off"
                    disabled={isLoading}
                    value={depositAmount}
                    onChange={e => handleChangeAmount(e)}
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
              onClick={event => handleDepositClick(event)}
              className={classNames(
                "btn btn--size2 has-loading",
                { disabled: !allowedToProceed },
                { "is-loading": isLoading }
              )}
            >
              <span>Deposit</span>

              <span className="loading-text">Processing</span>

              <strong className="dot-pulse" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Deposit);
