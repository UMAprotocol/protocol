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
      throw new Error("Contract is in unknown state: " + derivativeStorage.state);
  }
}

// Returns an object that contains data about the financial contract (TokenizedDerivative) at `tokenAddress`. The
// returned object contains a field `ready` that should be checked first.
function useFinancialContractData(tokenAddress) {
  const { drizzle, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const data = {};

  data.derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  data.name = useCacheCall(tokenAddress, "name");
  data.symbol = useCacheCall(tokenAddress, "symbol");
  data.nav = useCacheCall(tokenAddress, "calcNAV");
  data.tokenValue = useCacheCall(tokenAddress, "calcTokenValue");
  data.shortMarginBalance = useCacheCall(tokenAddress, "calcShortMarginBalance");
  data.excessMargin = useCacheCall(tokenAddress, "calcExcessMargin");
  // TODO(ptare): This may revert in certain cases (which are unlikely to come up now).
  data.updatedUnderlyingPrice = useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice");

  data.totalSupply = useCacheCall(tokenAddress, "totalSupply");
  data.tokenBalance = useCacheCall(tokenAddress, "balanceOf", account);

  if (!Object.values(data).every(Boolean)) {
    return { ready: false };
  }
  data.ready = true;

  // Format financial contract data for display.
  const { toBN } = web3.utils;
  const scalingFactor = toBN(web3.utils.toWei("1"));
  const computeSafePercentage = (numerator, denominator) =>
    denominator.isZero()
      ? "0"
      : toBN(numerator)
          .div(denominator)
          .muln(100);

  const totalSupplyBn = toBN(data.totalSupply);
  data.tokenOwnershipPercentage = computeSafePercentage(data.tokenBalance, totalSupplyBn);
  data.tokenOwnershipValue = totalSupplyBn.mul(toBN(data.tokenValue)).div(scalingFactor);
  const navBn = toBN(data.nav);
  const shortMarginBalanceBn = toBN(data.shortMarginBalance);
  data.totalHoldings = navBn.add(shortMarginBalanceBn);
  data.collateralizationRatio = computeSafePercentage(data.totalHoldings, navBn);
  data.minRequiredMargin = shortMarginBalanceBn.sub(toBN(data.excessMargin));
  data.minCollateralizationPercentage = computeSafePercentage(data.minRequiredMargin.add(navBn), navBn);
  const { stateText, stateColor } = getStateDescription(data.derivativeStorage);
  data.stateText = stateText;
  data.stateColor = stateColor;
  // TODO(ptare): The following fields still need to be added: Created, Expiry, and Price feed.
  data.detailsContent = [
    { type: "timestamp", title: "Last contract valuation", timestamp: data.updatedUnderlyingPrice.time },
    { type: "address", title: "Address", address: { display: tokenAddress } },
    { type: "address", title: "Sponsor", address: { display: data.derivativeStorage.externalAddresses.sponsor } },
    {
      type: "namedAddress",
      title: "Denomination",
      name: "DAI",
      address: { display: data.derivativeStorage.externalAddresses.marginCurrency }
    },
    {
      type: "namedAddress",
      title: "Return calculator",
      name: "1x",
      address: { display: data.derivativeStorage.externalAddresses.returnCalculator }
    }
  ];

  return data;
}

function ManagePositions(props) {
  const {
    drizzle: { web3 }
  } = drizzleReactHooks.useDrizzle();

  const data = useFinancialContractData(props.match.params.tokenAddress);
  if (!data.ready) {
    return <div>Loading data</div>;
  }

  const numDisplayedDecimals = 4;
  const format = valInWei => formatWithMaxDecimals(formatWei(valInWei, web3), numDisplayedDecimals, false);

  // This function is only added temporarily to make the diff more readable. Otherwise, github's diff tool isn't able
  // to recognize that the JSX below is mostly unchanged.
  function render() {
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
                      {data.name} ({data.symbol})
                    </span>

                    <div className="indicator">
                      <span
                        className="icon"
                        style={{
                          backgroundColor: `${data.stateColor}`
                        }}
                      />
                      {data.stateText}
                    </div>
                  </div>
                </div>

                {data.detailsContent && (
                  <div className="section__head-content">
                    <ExpandBox title="Details" content={data.detailsContent} />
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
                                  <span> Asset price </span>  is cash or equity in a margin trading account beyond what
                                  is required to open or maintain the account.{" "}
                                </p>
                              </Tooltip>
                            </td>

                            <td>
                              <strong>{format(data.updatedUnderlyingPrice.underlyingPrice)}</strong>
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
                              <strong>{format(data.tokenValue)} DAI</strong>
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
                                {format(data.totalHoldings)} DAI ({data.collateralizationRatio}%)
                              </strong>
                            </td>

                            <td>
                              <strong>(min. {data.minCollateralizationPercentage}% needed to avoid liquidation)</strong>
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
                              <strong>{format(data.nav)} DAI</strong>
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
                              <strong>{format(data.excessMargin)} DAI</strong>
                            </td>

                            <td>
                              <strong>(min. {format(data.minRequiredMargin)} DAI needed to avoid liquidation)</strong>
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
                              <strong>{format(data.totalSupply)} Tokens</strong>
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
                                {format(data.tokenBalance)} ({data.tokenOwnershipPercentage}%)
                              </strong>
                            </td>

                            <td>
                              <strong>({format(data.tokenOwnershipValue)} DAI)</strong>
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
  return render();
}

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(
  connect()(ManagePositions)
);
