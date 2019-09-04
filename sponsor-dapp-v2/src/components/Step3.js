import React, { useState, useRef, useEffect } from "react";

import classNames from "classnames";
import moment from "moment";
import web3 from "web3";

import IconSvgComponent from "components/common/IconSvgComponent";
import { useIdentifierConfig, useDaiAddress } from "lib/custom-hooks";
import { drizzleReactHooks } from "drizzle-react";
import { formatWei } from "common/FormattingUtils.js";

function getContractNameAndSymbol(selections) {
  // The date is supposed to look like Sep19 in the token name.
  const date = moment.unix(selections.expiry).format("MMMDD");

  // TODO(mrice32): nice to have - predict the first 4 digits of the deployed contract hash.
  const hash = web3.utils.randomHex(2);

  // Strip the "/" character from the string, so it appears as BTCUSD rather than BTC/USD.
  const asset = selections.identifier.replace("/", "");

  const assetShort = asset.substr(0, 3);

  // If either of these have been edited previously, use the previous value.
  return {
    name: selections.name ? selections.name : `${asset}_${date}_${hash}`,
    symbol: selections.symbol ? selections.symbol : `${assetShort}${hash}`
  };
}

function useCreateContract(userSelectionsRef, identifierConfig, onNextStep, state) {
  const { toWei, utf8ToHex } = web3.utils;
  const { drizzle, useCacheSend, useCacheCall } = drizzleReactHooks.useDrizzle();
  const { identifier, expiry } = userSelectionsRef.current;

  const currentPrice = useCacheCall("ManualPriceFeed", "latestPrice", utf8ToHex(userSelectionsRef.current.identifier));
  const daiAddress = useDaiAddress();

  const { send: rawSend, status, TXObjects } = useCacheSend("TokenizedDerivativeCreator", "createTokenizedDerivative");

  useEffect(() => {
    if (status === "success") {
      // Pull the contract address from the logs and set it in the higher level component so it can be passed elsewhere.
      userSelectionsRef.current.contractAddress =
        TXObjects[TXObjects.length - 1].receipt.events.CreatedTokenizedDerivative.returnValues.contractAddress;

      // Transition to the next step since the txn is complete.
      onNextStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!currentPrice || !daiAddress) {
    return {};
  }

  const send = () => {
    // 10^18 * 10^18, which represents 10^20%. This is large enough to never hit, but small enough that the numbers
    // will never overflow when multiplying by a balance.
    const withdrawLimit = "1000000000000000000000000000000000000";

    rawSend({
      defaultPenalty: toWei("1"),
      supportedMove: toWei(identifierConfig[identifier].supportedMove),
      product: utf8ToHex(identifier),
      fixedYearlyFee: "0",
      withdrawLimit: withdrawLimit,
      disputeDeposit: toWei("1"),
      returnCalculator: drizzle.contracts.LeveragedReturnCalculator.address,
      startingTokenPrice: currentPrice.price,
      expiry: expiry,
      marginCurrency: daiAddress,
      returnType: "0", // Linear
      startingUnderlyingPrice: currentPrice.price,
      name: state.contractName,
      symbol: state.tokenSymbol
    });
  };

  return { send, status };
}

function Step3(props) {
  const {
    userSelectionsRef: { current: selections }
  } = props;

  const { name, symbol } = getContractNameAndSymbol(selections);

  const identifierConfig = useIdentifierConfig();

  const [state, setState] = useState({
    allowedToProceed: true,
    isLoading: false,
    contractName: name,
    editingContractName: false,
    tokenSymbol: symbol,
    editingTokenSymbol: false
  });

  const contractNameTextRef = useRef(null);
  const contractSymbolTextRef = useRef(null);

  const { send, status } = useCreateContract(props.userSelectionsRef, identifierConfig, props.onNextStep, state);

  const handleClick = event => {
    event.preventDefault();
    event.persist();

    // Send txn.
    send();
  };

  const editContractName = () => {
    setState(oldState => ({
      ...oldState,
      editingContractName: true
    }));
  };

  const saveContractName = event => {
    event.preventDefault();

    let val = contractNameTextRef.current.value;

    // Only persist the name at a higher level if it was changed.
    // Note: the reason we do this is so that a new name is always generated when this page is mounted unless the user
    // saved a change to this field at some point in the past.
    if (val !== state.contractName) {
      props.userSelectionsRef.current.name = val;
    }

    setState(oldState => ({
      ...oldState,
      contractName: val,
      editingContractName: false
    }));
  };

  const editTokenSymbol = () => {
    setState(oldState => ({
      ...oldState,
      editingTokenSymbol: true
    }));
  };

  const saveTokenSymbol = event => {
    event.preventDefault();

    let val = contractSymbolTextRef.current.value;

    // Only persist the symbol at a higher level if it was changed.
    // Note: the reason we do this is so that a new symbol is always generated when this page is mounted unless the
    // user saved a change to this field at some point in the past.
    if (val !== state.tokenSymbol) {
      props.userSelectionsRef.current.symbol = val;
    }

    setState(oldState => ({
      ...oldState,
      tokenSymbol: val,
      editingTokenSymbol: false
    }));
  };

  if (!send) {
    return <div />;
  }

  const { toBN, toWei } = web3.utils;
  // Use BN rather than JS number to avoid precision issues.
  const collatReq = formatWei(
    toBN(toWei(identifierConfig[selections.identifier].supportedMove))
      .add(toBN(toWei("1")))
      .muln(100),
    web3
  );

  return (
    <>
      <div className="step__content">
        <p>
          Launch token facility
          <span>Confirm the parameters of the token facility </span>
        </p>
      </div>

      <div className="step__aside">
        <div className="step__entry">
          <ul className="list-selections">
            <li>
              Asset: <span>{selections.identifier}</span>
            </li>

            <li>
              Collateralization requirement: <span>{collatReq}%</span>
            </li>

            <li>
              Expiry: <span>{moment.unix(selections.expiry).format("MMMM DD, YYYY LTS")}</span>
            </li>

            <li>
              Contract name:
              {!state.editingContractName && (
                <span className="text">
                  {state.contractName}

                  <button type="button" className="btn-edit" onClick={editContractName}>
                    <IconSvgComponent iconPath="svg/ico-edit.svg" additionalClass="ico-edit" />
                  </button>
                </span>
              )}
              {state.editingContractName && (
                <div className="form-edit">
                  <form action="#" method="post" onSubmit={e => saveContractName(e)}>
                    <div className="form__controls">
                      <input
                        type="text"
                        className="field"
                        ref={contractNameTextRef}
                        defaultValue={state.contractName}
                      />
                    </div>

                    <div className="form__actions">
                      <button type="submit" className="form__btn">
                        <IconSvgComponent iconPath="svg/ico-check.svg" additionalClass="ico-check" />
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </li>

            <li>
              Token symbol:
              {!state.editingTokenSymbol && (
                <span className="text">
                  {state.tokenSymbol}

                  <button type="button" className="btn-edit" onClick={editTokenSymbol}>
                    <IconSvgComponent iconPath="svg/ico-edit.svg" additionalClass="ico-edit" />
                  </button>
                </span>
              )}
              {state.editingTokenSymbol && (
                <div className="form-edit">
                  <form action="#" method="post" onSubmit={e => saveTokenSymbol(e)}>
                    <div className="form__controls">
                      <input
                        type="text"
                        className="field"
                        ref={contractSymbolTextRef}
                        defaultValue={state.tokenSymbol}
                      />
                    </div>

                    <div className="form__actions">
                      <button type="submit" className="form__btn">
                        <IconSvgComponent iconPath="svg/ico-check.svg" additionalClass="ico-check" />
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </li>
          </ul>
        </div>

        <div className="step__actions">
          <a href="test" className="btn btn--alt" onClick={props.onPrevStep}>
            Back
          </a>

          <a
            href="test"
            onClick={e => handleClick(e)}
            className={classNames("btn has-loading", {
              disabled: !state.allowedToProceed,
              "is-loading": status === "pending"
            })}
          >
            <span>Create Contract</span>

            <span className="loading-text">Processing</span>

            <strong className="dot-pulse" />
          </a>
        </div>
      </div>
    </>
  );
}

export default Step3;
