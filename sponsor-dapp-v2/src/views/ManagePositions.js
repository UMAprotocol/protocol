import React from "react";
import { Link } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";
import { useSendGaPageview } from "lib/google-analytics";
import classNames from "classnames";

import Header from "components/common/Header";
import ExpandBox from "components/common/ExpandBox";
import Tooltip from "components/common/Tooltip";
import { withAddedContract } from "lib/contracts";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { createFormatFunction } from "common/FormattingUtils";
import { useEtherscanUrl, revertWrapper } from "lib/custom-hooks";
import { ContractStateEnum } from "common/TokenizedDerivativeUtils";

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

  const etherscanUrl = useEtherscanUrl();

  const { account } = drizzleReactHooks.useDrizzleState(drizzleState => ({
    account: drizzleState.accounts[0]
  }));

  const data = {};

  data.derivativeStorage = useCacheCall(tokenAddress, "derivativeStorage");
  data.name = useCacheCall(tokenAddress, "name");
  data.symbol = useCacheCall(tokenAddress, "symbol");
  data.nav = revertWrapper(useCacheCall(tokenAddress, "calcNAV"));
  data.tokenValue = revertWrapper(useCacheCall(tokenAddress, "calcTokenValue"));
  data.shortMarginBalance = revertWrapper(useCacheCall(tokenAddress, "calcShortMarginBalance"));
  data.excessMargin = revertWrapper(useCacheCall(tokenAddress, "calcExcessMargin"));

  const updatedUnderlyingPrice = revertWrapper(useCacheCall(tokenAddress, "getUpdatedUnderlyingPrice"));

  // If the blockchain value === null, this means that the call reverted, so we just make its children null (to prevent access errors down the line).
  data.updatedUnderlyingPrice =
    updatedUnderlyingPrice !== null ? updatedUnderlyingPrice : { underlyingPrice: null, time: null };

  data.totalSupply = useCacheCall(tokenAddress, "totalSupply");
  data.tokenBalance = useCacheCall(tokenAddress, "balanceOf", account);

  if (!Object.values(data).every(val => val !== undefined)) {
    return { ready: false };
  }
  data.ready = true;

  data.priceFeedAddress = data.derivativeStorage.externalAddresses.priceFeedAddress;

  // Format financial contract data for display.
  const { toBN, toChecksumAddress } = web3.utils;
  data.isTokenSponsor =
    toChecksumAddress(account) === toChecksumAddress(data.derivativeStorage.externalAddresses.sponsor);
  const scalingFactor = toBN(web3.utils.toWei("1"));
  const computeSafePercentage = (numerator, denominator) =>
    denominator.isZero()
      ? "0"
      : toBN(numerator)
          .muln(100)
          .div(denominator);

  const totalSupplyBn = toBN(data.totalSupply);
  data.tokenOwnershipPercentage = computeSafePercentage(data.tokenBalance, totalSupplyBn);
  data.totalHoldings = toBN(data.derivativeStorage.longBalance).add(toBN(data.derivativeStorage.shortBalance));

  if (data.nav && data.shortMarginBalance && data.excessMargin && data.tokenValue) {
    data.tokenOwnershipValue = toBN(data.tokenBalance)
      .mul(toBN(data.tokenValue))
      .div(scalingFactor);
    const navBn = toBN(data.nav);
    const shortMarginBalanceBn = toBN(data.shortMarginBalance);
    data.collateralizationRatio = computeSafePercentage(data.totalHoldings, navBn);
    data.minRequiredMargin = shortMarginBalanceBn.sub(toBN(data.excessMargin));
    data.minCollateralizationPercentage = computeSafePercentage(data.minRequiredMargin.add(navBn), navBn);
    data.frozen = false;
  } else {
    data.tokenOwnershipValue = null;
    data.collateralizationRatio = null;
    data.minRequiredMargin = null;
    data.minCollateralizationPercentage = null;
    data.frozen = true;
  }
  const { stateText, stateColor } = getStateDescription(data.derivativeStorage);
  data.stateText = stateText;
  data.stateColor = stateColor;
  data.detailsContent = [
    { type: "link", link: { href: `${etherscanUrl}address/${tokenAddress}`, text: "Etherscan" } },
    { type: "timestamp", title: "Last contract valuation", timestamp: data.updatedUnderlyingPrice.time },
    { type: "address", title: "Address", address: { display: tokenAddress } },
    { type: "address", title: "Sponsor", address: { display: data.derivativeStorage.externalAddresses.sponsor } },
    { type: "timestamp", title: "Created", timestamp: data.derivativeStorage.fixedParameters.creationTime },
    { type: "timestamp", title: "Expiry", timestamp: data.derivativeStorage.endTime },
    { type: "address", title: "Price feed", address: { display: data.priceFeedAddress } },
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

  // The user must be the token sponsor, the contract must be in the live state (and not be ready to expire) for the
  // manage buttons to be enabled.
  data.canManagePosition =
    data.isTokenSponsor && !data.frozen && data.derivativeStorage.state === ContractStateEnum.LIVE;

  // There are two cases where the redeem button should be enabled:
  // 1. General contract management is enabled for this user.
  // 2. The contract is settled.
  data.canRedeem = data.canManagePosition || data.derivativeStorage.state === ContractStateEnum.SETTLED;

  // The user can withdraw whenever they can redeem as long as they are the token sponsor.
  data.canWithdraw = data.canRedeem && data.isTokenSponsor;

  return data;
}

function ManagePositions(props) {
  useSendGaPageview("/ManagePositions");
  const {
    drizzle: { web3 }
  } = drizzleReactHooks.useDrizzle();

  const { tokenAddress } = props.match.params;
  const data = useFinancialContractData(tokenAddress);
  if (!data.ready) {
    return <div>Loading data</div>;
  }

  const formatValidValue = createFormatFunction(web3, 4);
  const format = val => (val ? formatValidValue(val) : "--");

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
                  <h4>Tokens</h4>
                </div>

                <div className="detail-box__body">
                  <div className="detail-box__table">
                    <table>
                      <tbody>
                        <tr>
                          <td>
                            Reference price index
                            <Tooltip>
                              <p>
                                <span> Reference price index </span> is the price index that each synthetic token's
                                value references
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{format(data.updatedUnderlyingPrice.underlyingPrice)}</strong>
                          </td>
                          <td />
                        </tr>

                        <tr>
                          <td>
                            Token value
                            <Tooltip>
                              <p>
                                <span> Token Value </span> is the value, in DAI, of each synthetic token
                              </p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{format(data.tokenValue)} DAI</strong>
                          </td>
                          <td />
                        </tr>

                        <tr>
                          <td>
                            Token supply
                            <Tooltip>
                              <p>
                                <span>Token supply</span> is the total number of tokens that have been created with this
                                token facility
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
                              <p>This is the number of tokens you currently own in your wallet</p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>
                              {format(data.tokenBalance)} ({data.tokenOwnershipPercentage.toString()}%)
                            </strong>
                          </td>

                          <td>
                            <strong>({format(data.tokenOwnershipValue)} DAI)</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="detail-box__actions">
                      <Link
                        to={"/Borrow/" + tokenAddress}
                        className={classNames("btn", {
                          disabled: !data.canManagePosition
                        })}
                      >
                        <span>Borrow more tokens</span>
                      </Link>

                      <Link
                        to={"/Repay/" + tokenAddress}
                        className={classNames("btn", {
                          disabled: !data.canRedeem
                        })}
                      >
                        <span>Repay token debt</span>
                      </Link>
                    </div>
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
                              <p>The total amount of DAI that has been deposited into the custom token facility</p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>
                              {format(data.totalHoldings)} DAI (
                              {data.collateralizationRatio ? data.collateralizationRatio.toString() : "--"}%)
                            </strong>
                          </td>

                          <td>
                            <strong>
                              (min.{" "}
                              {data.minCollateralizationPercentage
                                ? data.minCollateralizationPercentage.toString()
                                : "--"}
                              % needed to avoid liquidation)
                            </strong>
                          </td>
                        </tr>

                        <tr>
                          <td>
                            Value of token debt
                            <Tooltip>
                              <p>
                                The value of all synthetic tokens that have been borrowed from the custom token facility
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
                              <p>Total collateral minus value of token debt</p>
                            </Tooltip>
                          </td>

                          <td>
                            <strong>{format(data.shortMarginBalance)} DAI</strong>
                          </td>

                          <td>
                            <strong>(min. {format(data.minRequiredMargin)} DAI needed to avoid liquidation)</strong>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="detail-box__actions">
                    <Link
                      to={"/Withdraw/" + tokenAddress}
                      className={classNames("btn", {
                        disabled: !data.canWithdraw
                      })}
                    >
                      <span>Withdraw collateral</span>
                    </Link>

                    <Link
                      to={"/Deposit/" + tokenAddress}
                      className={classNames("btn", {
                        disabled: !data.canManagePosition
                      })}
                    >
                      <span>Deposit additional collateral</span>
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

export default withAddedContract(TokenizedDerivative.abi, props => props.match.params.tokenAddress)(ManagePositions);
