import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import classNames from "classnames";

import Header from "components/common/Header";
import IconSvgComponent from "components/common/IconSvgComponent";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";

function useTextInput() {
  const [amount, setAmount] = useState("");
  const handleChangeAmount = event => {
    // Check if regex number matches
    if (/^(\s*|\d+)$/.test(event.target.value)) {
      setAmount(event.target.value);
    }
  };
  return { amount, handleChangeAmount };
}

function useSendTransactionOnLink(cacheSend, amount, history) {
  const { drizzle } = drizzleReactHooks.useDrizzle();
  const { toWei } = drizzle.web3.utils;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const { send, status } = cacheSend;
  const [linkedPage, setLinkedPage] = useState();
  const handleSubmit = event => {
    event.preventDefault();

    const linkedPage = event.currentTarget.getAttribute("href");
    setLinkedPage(linkedPage);
    send(toWei(amount), { from: account });
  };
  // If we've successfully withdrawn, reroute to the linkedPage whose `Link` the user clicked on (currently, this can only
  // ever be the `ManagePositions` linkedPage).
  useEffect(() => {
    if (status === "success" && linkedPage) {
      history.replace(linkedPage);
    }
  }, [status, linkedPage, history]);
  return handleSubmit;
}

function useCollateralizationInformation(tokenAddress, changeInShortBalance) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { toBN, toWei } = web3.utils;
  const data = {};
  data.derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  data.nav = useCacheCall(tokenAddress, "calcNAV");
  data.shortMarginBalance = useCacheCall(tokenAddress, "calcShortMarginBalance");

  if (!Object.values(data).every(Boolean)) {
    return { ready: false };
  }

  data.collateralizationRequirement = toBN(data.derivativeStorage.fixedParameters.supportedMove)
    .add(toBN(toWei("1")))
    .muln(100);

  data.currentCollateralization = "-- %";
  data.newCollateralizationAmount = "-- %";
  const navBn = toBN(data.nav);
  if (!navBn.isZero()) {
    data.totalHoldings = navBn.add(toBN(data.shortMarginBalance));
    data.currentCollateralization = data.totalHoldings.muln(100).div(navBn) + "%";
    if (changeInShortBalance !== "") {
      data.newCollateralizationAmount =
        data.totalHoldings
          .sub(toBN(toWei(changeInShortBalance)))
          .muln(100)
          .div(navBn) + "%";
    }
  }
  data.ready = true;
  return data;
}

function Withdraw(props) {
  const { tokenAddress } = props.match.params;

  const { drizzle, useCacheSend } = drizzleReactHooks.useDrizzle();
  const { fromWei } = drizzle.web3.utils;

  const { amount: withdrawAmount, handleChangeAmount } = useTextInput();

  const { send, status } = useCacheSend(tokenAddress, "withdraw");
  const handleWithdrawClick = useSendTransactionOnLink({ send, status }, withdrawAmount, props.history);

  const data = useCollateralizationInformation(tokenAddress, withdrawAmount);
  if (!data.ready) {
    return <div>Loading withdraw data</div>;
  }

  // TODO(ptare): Determine the right set of conditions to allow proceeding.
  const allowedToProceed = withdrawAmount !== "";
  const isLoading = status === "pending";

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
  };
  return render();
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(Withdraw);
