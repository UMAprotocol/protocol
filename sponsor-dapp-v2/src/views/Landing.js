import React, { Component } from "react";
import { Link } from "react-router-dom";

import IconSvgComponent from "components/common/IconSvgComponent";

import Header from "components/common/Header";
import Footer from "components/common/Footer";

class Landing extends Component {
  render() {
    return (
      <div className="wrapper">
        <Header />

        <div className="main">
          <div className="shell">
            <section className="section section--about">
              <h2>This is a developer tool that lets you:</h2>
              <div className="section__entry">
                <p>Demonstrate how you can use UMA infrastructure </p>

                <p>Deploy a custom token facility</p>

                <p>Borrow synthetic ERC20 tokens and track the price of anything</p>
              </div>

              <Link to="/Start" className="btn">
                Get started
              </Link>
            </section>

            <section className="section section--service-items">
              <h2>How it works:</h2>

              <div className="service-items">
                <div className="service-item">
                  <h3>Create a derivative</h3>

                  <ul className="list-examples">
                    <li>
                      <span className="icon">
                        <IconSvgComponent iconPath="svg/ico-open-door.svg" additionalClass="ico-open-door" />
                      </span>

                      <p>Open up a facility</p>
                    </li>

                    <li>
                      <span className="icon">
                        <IconSvgComponent iconPath="svg/ico-deposit.svg" additionalClass="ico-deposit" />
                      </span>

                      <p>Deposit collateral</p>
                    </li>

                    <li>
                      <span className="icon">
                        <IconSvgComponent iconPath="svg/ico-borrow.svg" additionalClass="ico-borrow" />
                      </span>

                      <p>Borrow synthetic token</p>
                    </li>
                  </ul>
                </div>

                <div className="service-item">
                  <h3>Manage your risk</h3>

                  <ul className="list-examples">
                    <li>
                      <span className="icon">
                        <IconSvgComponent iconPath="svg/ico-sell-tokens.svg" additionalClass="ico-sell-tokens" />
                      </span>

                      <p>Sell tokens to leverage risk exposure</p>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          </div>
        </div>

        <Footer />
      </div>
    );
  }
}

export default Landing;
