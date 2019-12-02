import React from "react";
import { Link, Redirect } from "react-router-dom";
import { drizzleReactHooks } from "drizzle-react";
import TokenizedDerivative from "contracts/TokenizedDerivative.json";
import { formatWei, formatWithMaxDecimals } from "common/FormattingUtils";
import {
  useEtherscanUrl,
  useEthFaucetUrl,
  useDaiFaucetRequest,
  computeLiquidationPrice,
  revertWrapper
} from "lib/custom-hooks";
import { createFormatFunction } from "common/FormattingUtils";
import { useSendGaPageview } from "lib/google-analytics";

import Header from "components/common/Header";
import Position from "components/Position";

const BigNumber = require("bignumber.js");

function usePositionList() {
  const { drizzle, useCacheCallPromise } = drizzleReactHooks.useDrizzle();
  const { web3 } = drizzle;
  const { hexToUtf8 } = web3.utils;
  const account = drizzleReactHooks.useDrizzleStatePromise((drizzleState, resolvePromise) => {
    if (drizzleState.accounts[0]) {
      resolvePromise(drizzleState.accounts[0]);
    }
  });

  const registeredContracts = useCacheCallPromise("Registry", "getRegisteredDerivatives", account);

  const finishedAddingContracts = drizzleReactHooks.useDrizzleStatePromise(
    (drizzleState, resolvePromise, registeredContractsResolved) => {
      let finished = true;

      for (const registeredContract of registeredContractsResolved) {
        if (!drizzleState.contracts[registeredContract]) {
          finished = false;
          drizzle.addContract({
            contractName: registeredContract,
            web3Contract: new drizzle.web3.eth.Contract(TokenizedDerivative.abi, registeredContract)
          });
        }
      }

      if (finished) {
        resolvePromise(true);
      }
    },
    [registeredContracts]
  );

  const etherscanUrl = useEtherscanUrl();

  const positions = useCacheCallPromise(
    "NotApplicable",
    (
      contractCall,
      resolvePromise,
      registeredContractsResolved,
      accountResolved,
      etherscanPrefix,
      finishedAddingContracts
    ) => {
      let finished = true;

      const call = (contractName, methodName, ...args) => {
        const callResult = contractCall(contractName, methodName, ...args);
        if (callResult === undefined) {
          finished = false;
        }
        return callResult;
      };

      const format = createFormatFunction(web3, 4);

      // Added a strange number as the fallback so it's obvious if this number ever makes it to the user.
      const formatTokenAmounts = valInWei =>
        valInWei ? formatWithMaxDecimals(formatWei(valInWei, web3), 4, false) : "-999999999";

      const positions = registeredContractsResolved.map(registeredContract => {
        const name = call(registeredContract, "name");
        const totalSupply = formatTokenAmounts(call(registeredContract, "totalSupply"));
        const yourSupply = formatTokenAmounts(call(registeredContract, "balanceOf", accountResolved));
        const netPosition = BigNumber(yourSupply)
          .minus(BigNumber(totalSupply))
          .toString();

        // These are needed to compute the liquidation price.
        const nav = revertWrapper(call(registeredContract, "calcNAV"));
        const excessMargin = revertWrapper(call(registeredContract, "calcExcessMargin"));
        const underlyingPriceTime = revertWrapper(call(registeredContract, "getUpdatedUnderlyingPrice"));
        const liquidationPrice = computeLiquidationPrice(web3, nav, excessMargin, underlyingPriceTime);
        const derivativeStorage = call(registeredContract, "derivativeStorage");

        return {
          address: {
            display: registeredContract,
            link: `${etherscanPrefix}/address/${registeredContract}`
          },
          tokenName: name,
          liquidationPrice: liquidationPrice ? format(liquidationPrice) : "--",
          identifier: derivativeStorage ? hexToUtf8(derivativeStorage.fixedParameters.product) : undefined,
          exposures: [
            {
              type: "tokenFacility",
              items: {
                // TODO(mrice32): not sure if this is just the name of the token or the leverage + underlying.
                direction: `Short ${name}`,
                totalExposure: totalSupply,
                yourExposure: totalSupply
              }
            },
            {
              type: "tokens",
              items: {
                direction: `Long ${name}`,
                totalExposure: totalSupply,
                yourExposure: yourSupply
              }
            },
            {
              type: "netExposure",
              items: {
                direction: "",
                totalExposure: "",
                yourExposure: netPosition
              }
            }
          ]
        };
      });

      if (finished) {
        resolvePromise(positions);
      }
    },
    registeredContracts,
    account,
    etherscanUrl,
    finishedAddingContracts
  );

  drizzleReactHooks.useRerenderOnResolution(positions);

  return positions.isResolved ? positions.resolvedValue : undefined;
}

function ViewPositions(props) {
  const { history } = props;
  useSendGaPageview("/ViewPositions");
  const positions = usePositionList();
  const ethFaucetUrl = useEthFaucetUrl();
  const daiFaucetRequest = useDaiFaucetRequest();

  // TODO(mrice32): should we have some sort of loading screen to show while data is being pulled?
  if (positions === undefined) {
    return null;
  }

  // TODO(mrice32): potentially merge Start and ViewPositions pages to simplify.
  // Always redirect to the start screen if there are no positions.
  if (positions.length === 0) {
    return <Redirect to="/Start" />;
  }

  return (
    <div className="wrapper">
      <Header />

      <div className="main">
        <div className="shell">
          <section className="section section--intro section--intro-alt">
            <div className="section__actions">
              <Link to="/Steps" className="btn btn--size1">
                Open token facility
              </Link>

              <div className="section__actions-inner">
                {ethFaucetUrl ? (
                  <a href={ethFaucetUrl} target="_blank" rel="noopener noreferrer" className="btn btn--grey btn--size1">
                    Testnet ETH faucet
                  </a>
                ) : null}

                {daiFaucetRequest ? (
                  <a
                    href="test"
                    onClick={daiFaucetRequest}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--grey btn--size1"
                  >
                    Testnet DAI faucet
                  </a>
                ) : null}
              </div>
            </div>

            <div className="section__content">
              <h2>Current risk exposure</h2>

              <div className="positions">
                {positions.map((position, pIdx, positionsArr) => {
                  return (
                    <Position
                      key={`position-${pIdx}`}
                      position={position}
                      index={pIdx}
                      totalLength={positionsArr.length}
                      history={history}
                    />
                  );
                })}
              </div>
            </div>

            <div className="section__entry">
              <h2>Ready to create a new position?</h2>
            </div>

            <div className="section__actions">
              <Link to="/Steps" className="btn btn--size1">
                Open token facility
              </Link>
            </div>

            <div className="section__hint">
              <p>*You will need Testnet ETH and DAI before opening token facility</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default ViewPositions;
