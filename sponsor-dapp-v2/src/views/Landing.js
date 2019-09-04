import React from "react";
import { Link, Redirect } from "react-router-dom";
import { useNumRegisteredContracts } from "lib/custom-hooks";

import IconSvgComponent from "components/common/IconSvgComponent";

import Header from "components/common/Header";
import Footer from "components/common/Footer";

function Landing() {
  const numContracts = useNumRegisteredContracts();

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
          <section className="section section--about">
            <h2>UMA's Synthetic Token Builder lets you:</h2>
            <div className="section__entry">
              <p>
                - Deploy a custom “token facility” smart contract to the Rinkeby testnet that will create a long and a
                short exposure to anything with a price
              </p>

              <p>- Borrow synthetic tokens that represent long price risk</p>

              <p>- Manage your token facility, which represents short price risk</p>
            </div>

            <Link to="/Start" className="btn">
              Get started
            </Link>
          </section>

          <section className="section section--service-items">
            <h2>How to build a custom token:</h2>

            <div className="service-items">
              <div className="service-item">
                <ul className="list-examples">
                  <li>
                    <span className="icon">
                      <IconSvgComponent iconPath="svg/ico-open-door.svg" additionalClass="ico-open-door" />
                    </span>

                    <p>Deploy a customized token facility</p>
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

                    <p>Borrow and sell synthetic tokens (tokens = long price risk)</p>
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

export default Landing;
