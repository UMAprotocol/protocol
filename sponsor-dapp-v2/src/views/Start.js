import React from "react";
import { Link, Redirect } from "react-router-dom";
import { useNumRegisteredContracts, useEthFaucetUrl, useDaiFaucetRequest } from "lib/custom-hooks";
import { useSendGaPageview } from "lib/google-analytics";

import Header from "components/common/Header";

function StartScreen() {
  useSendGaPageview("/Start");
  const numContracts = useNumRegisteredContracts();
  const ethFaucetUrl = useEthFaucetUrl();
  const daiFaucetRequest = useDaiFaucetRequest();

  if (numContracts === undefined) {
    return null;
  }

  if (numContracts !== 0) {
    return <Redirect to="/ViewPositions" />;
  }

  return (
    <div className="wrapper">
      <Header />

      <div className="main">
        <div className="shell">
          <section className="section section--intro">
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

            <div className="section__entry">
              <h2>Current risk exposure</h2>
              <div style={{ marginTop: "100px", marginBottom: "100px", marginLeft: "100px", fontSize: "28px" }}>
                No open token facilities*
              </div>

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

export default StartScreen;
