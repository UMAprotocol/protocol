import React from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";

import Header from "components/common/Header";
import ExpandBox from "components/common/ExpandBox";
import Tooltip from "components/common/Tooltip";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { formatWei, formatWithMaxDecimals } from "common/FormattingUtils";

function getStateDescription(derivativeStorage) {
  switch (derivativeStorage.state) {
    case "0":
      return {
        stateText: "Live",
        stateColor: "green"
      };
    case "1":
      return {
        stateText: "Disputed",
        stateColor: "yellow"
      };
    case "2":
      return {
        stateText: "Expired",
        stateColor: "yellow"
      };
    case "3":
      return {
        stateText: "Defaulted",
        stateColor: "red"
      };
    case "4":
      return {
        stateText: "Emergency",
        stateColor: "red"
      };
    case "5":
      return {
        stateText: "Settled",
        stateColor: "blue"
      };
    default:
      throw new Error("oh no");
  }
}

function ManagePositions(props) {
  const { managePosition } = props;
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { tokenAddress } = props.match.params;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");

  const name = useCacheCall(tokenAddress, "name");
  const symbol = useCacheCall(tokenAddress, "symbol");

  // `nav` is also the long margin balance.
  const nav = useCacheCall(tokenAddress, "calcNAV");
  const tokenValue = useCacheCall(tokenAddress, "calcTokenValue");
  const shortMarginBalance = useCacheCall(tokenAddress, "calcShortMarginBalance");
  const excessMargin = useCacheCall(tokenAddress, "calcExcessMargin");
  // TODO(ptare): This may be revert in certain cases.
  const updatedUnderlyingPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");

  const totalSupply = useCacheCall(tokenAddress, "totalSupply");
  const tokenBalance = useCacheCall(tokenAddress, "balanceOf", account);

  if (!managePosition) {
    return null;
  }
  const dataFetched =
    derivativeStorage &&
    name &&
    symbol &&
    tokenValue &&
    shortMarginBalance &&
    excessMargin &&
    updatedUnderlyingPrice &&
    totalSupply &&
    tokenBalance;
  if (!dataFetched) {
    return <div>Loading</div>;
  }

  const { toBN } = web3.utils;
  const totalSupplyBn = toBN(totalSupply);
  const tokenOwnershipPercentage = totalSupplyBn.isZero()
    ? "0"
    : toBN(tokenBalance)
        .div(totalSupplyBn)
        .muln(100);
  // TODO: divide out by 1e18?
  const tokenOwnershipValue = totalSupplyBn.mul(toBN(tokenValue));

  const totalHoldings = toBN(nav).add(toBN(shortMarginBalance));
  const collaterilizationRatio = toBN(nav).isZero()
    ? "0"
    : toBN(totalHoldings)
        .div(toBN(nav))
        .muln(100);
  const minRequiredMargin = toBN(shortMarginBalance).sub(toBN(excessMargin));

  const minCollPercentage = toBN(nav).isZero()
    ? "0"
    : minRequiredMargin
        .add(nav)
        .div(toBN(nav))
        .muln(100);
  const { stateText, stateColor } = getStateDescription(derivativeStorage);

  const { address } = managePosition.contractStatus;

  return (
    <div className="wrapper">
      <Header />

      <div className="main">
        <div className="shell">
          <section className="section-edit">
            <Link to="/ViewPositions" className="link-default">
              View all contracts
            </Link>

            <div className="section__head">
              <div className="section__head-aside">
                <div className="section__status">
                  <span>
                    {name} ({symbol})
                  </span>

                  <div className="indicator">
                    <span
                      className="icon"
                      style={{
                        backgroundColor: `${stateColor}`
                      }}
                    />
                    {stateText}
                  </div>
                </div>
              </div>

              {managePosition.details && (
                <div className="section__head-content">
                  <ExpandBox title="Details" content={managePosition.details} />
                </div>
              )}
            </div>

            <div className="section__body">
              <div className="detail-box">
                <div className="detail-box__head">
                  <h4>Assets</h4>
                </div>

                <div className="detail-box__body">
                  <div className="detail-box__table">
                    <table>
                      <tbody>
                        <tr>
                          <td>
                            Asset price
                            <Tooltip>
                              <p>
                                {" "}
                                <span> Asset price </span>  is cash or equity in a margin trading account beyond what is
                                required to open or maintain the account.{" "}
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>
                              {formatWithMaxDecimals(formatWei(updatedUnderlyingPrice.underlyingPrice, web3), 4, false)}
                            </strong>
                          </td>
                        </tr>

                        <tr>
                          <td>
                            Value
                            <Tooltip>
                              <p>
                                {" "}
                                <span> Value </span>  is cash or equity in a margin trading account beyond what is
                                required to open or maintain the account.{" "}
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{formatWithMaxDecimals(formatWei(tokenValue, web3), 4, false)} DAI</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="detail-box">
                <div className="detail-box__head">
                  <h4>Collateral</h4>
                </div>

                <div className="detail-box__body">
                  <div className="detail-box__table">
                    <table>
                      <tbody>
                        <tr>
                          <td>
                            Total collateral
                            <Tooltip>
                              <p>
                                {" "}
                                <span> Total collateral </span> Lorem ipsum dolor sit amet.
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>
                              {totalHoldings.toString()} DAI ({collaterilizationRatio}%)
                            </strong>
                          </td>

                          <td>
                            <strong>(min. {minCollPercentage}% needed to avoid liquidation)</strong>
                          </td>
                        </tr>

                        <tr>
                          <td>
                            Token debt
                            <Tooltip>
                              <p>
                                <span>Token debt</span> Lorem ipsum dolor sit amet.
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{nav} DAI</strong>
                          </td>

                          <td>&nbsp;</td>
                        </tr>

                        <tr>
                          <td>
                            Excess collateral
                            <Tooltip>
                              <p>
                                {" "}
                                <span>Excess collateral</span> Lorem ipsum dolor sit amet.
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{excessMargin.toString()} DAI</strong>
                          </td>

                          <td>
                            <strong>(min. {minRequiredMargin.toString()} DAI needed to avoid liquidation)</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="detail-box__actions">
                    <Link to="/Withdraw" className="btn">
                      <span>Withdraw collateral</span>
                    </Link>

                    <Link to="/Deposit" className="btn">
                      <span>Deposit additional collateral</span>
                    </Link>
                  </div>
                </div>
              </div>

              <div className="detail-box">
                <div className="detail-box__head">
                  <h4>Tokens</h4>
                </div>

                <div className="detail-box__body">
                  <div className="detail-box__table">
                    <table>
                      <tbody>
                        <tr>
                          <td>
                            Token supply
                            <Tooltip>
                              <p>
                                <span>Token supply</span> Lorem ipsum dolor sit amet.
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{totalSupply} Tokens</strong>
                          </td>

                          <td>&nbsp;</td>
                        </tr>

                        <tr>
                          <td>
                            Your tokens
                            <Tooltip>
                              <p>
                                {" "}
                                <span>Your tokens</span> Lorem ipsum dolor sit amet.
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>
                              {tokenBalance} ({tokenOwnershipPercentage}%)
                            </strong>
                          </td>

                          <td>
                            <strong>({tokenOwnershipValue.toString()} DAI)</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="detail-box__actions">
                    <Link to="/Borrow" className="btn">
                      <span>Borrow more tokens</span>
                    </Link>

                    <Link to="/Repay" className="btn">
                      <span>Repay token debt</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(
  connect(
    state => ({
      managePosition: state.positionsData.managePositions
    }),
    {
      // fetchAllPositions
    }
  )(ManagePositions)
);
