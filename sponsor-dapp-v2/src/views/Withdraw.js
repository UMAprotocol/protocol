import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";

function Withdraw(props) {
  const { tokenAddress } = props.match.params;

  const { drizzle, useCacheCall, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, fromWei, toWei } = web3.utils;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  const nav = useCacheCall(tokenAddress, "calcNAV");
  const shortMarginBalance = useCacheCall(tokenAddress, "calcShortMarginBalance");

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const handleChangeAmount = event => {
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
      setWithdrawAmount(event.target.value);
    }
  };

  const { send: withdraw, status: withdrawStatus } = useCacheSend(tokenAddress, "withdraw");
  const [linkedPage, setLinkedPage] = useState();
  const handleWithdrawClick = event => {
    event.preventDefault();

    const linkedPage = event.currentTarget.getAttribute("href");
    setLinkedPage(linkedPage);
    withdraw(toWei(withdrawAmount), { from: account });
  };
  // If we've successfully withdrawn, reroute to the linkedPage whose `Link` the user clicked on (currently, this can only
  // ever be the `ManagePositions` linkedPage).
  useEffect(() => {
    if (withdrawStatus === "success" && linkedPage) {
      props.history.replace(linkedPage);
    }
  }, [withdrawStatus, linkedPage, props.history]);

  const dataFetched = derivativeStorage && nav && shortMarginBalance;
  if (!dataFetched) {
    return <div>Loading withdraw data</div>;
  }

  const collateralizationRequirement = toBN(derivativeStorage.fixedParameters.supportedMove)
    .add(toBN(toWei("1")))
    .muln(100);

  let currentCollateralization = "-- %";
  let newCollateralizationAmount = "-- %";
  const navBn = toBN(nav);
  if (!navBn.isZero()) {
    const totalHoldings = navBn.add(toBN(shortMarginBalance));
    currentCollateralization = totalHoldings.muln(100).div(navBn) + "%";
    if (withdrawAmount !== "") {
      newCollateralizationAmount =
        totalHoldings
          .sub(toBN(toWei(withdrawAmount)))
          .muln(100)
          .div(navBn) + "%";
    }
  }

  // TODO(ptare): Determine the right set of conditions to allow proceeding.
  const allowedToProceed = withdrawAmount !== "";
  const isLoading = withdrawStatus === "pending";

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
              <h3>Withdraw collateral from facility</h3>

              <div className="popup__head-entry">
                <p>
                  <strong>
                    Your facility has a {fromWei(collateralizationRequirement)}% collateralization requirement.
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
                      <span>{currentCollateralization}</span>
                    </li>

                    <li className={classNames({ highlight: allowedToProceed })}>
                      <strong>New:</strong>
                      <span>{newCollateralizationAmount}</span>
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
  };
  return render();
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Withdraw);
