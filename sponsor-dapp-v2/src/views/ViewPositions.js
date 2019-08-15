import React, { Component } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";

import Header from "components/common/Header";
import Position from "components/Position";

class ViewPositions extends Component {
  render() {
    const { landingPositions } = this.props;

    if (!landingPositions) {
      return null;
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
                  <a
                    href={landingPositions.testnetEthFaucet.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--grey btn--size1"
                  >
                    Testnet ETH faucet
                  </a>

                  <a
                    href={landingPositions.testnetDaiFaucet.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--grey btn--size1"
                  >
                    Testnet DAI faucet
                  </a>
                </div>
              </div>

              <div className="section__content">
                <h2>Current risk exposure</h2>

                <div className="positions">
                  {landingPositions.positions.map((position, pIdx) => {
                    return <Position key={`position-${pIdx}`} position={position} />;
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
}

export default connect(
  state => ({
    landingPositions: state.positionsData.landingPositions
  }),
  {
    // fetchAllPositions
  }
)(ViewPositions);
