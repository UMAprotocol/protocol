import React from "react";
import { connect } from "react-redux";
import { Link, Redirect } from "react-router-dom";
import { useNumRegisteredContracts, useFaucetUrls } from "lib/custom-hooks";

import Header from "components/common/Header";

function StartScreen() {
  const numContracts = useNumRegisteredContracts();
  const faucetUrls = useFaucetUrls();

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
                {faucetUrls.eth ? (
                  <a
                    href={faucetUrls.eth}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--grey btn--size1"
                  >
                    Testnet ETH faucet
                  </a>
                ) : null}

                {faucetUrls.dai ? (
                  <a
                    href={faucetUrls.dai}
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
              <h2>You currently have no risk exposure.</h2>

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

export default connect(
  state => ({
    landingPositions: state.positionsData.landingPositions
  }),
  {
    // fetchAllPositions
  }
)(StartScreen);
