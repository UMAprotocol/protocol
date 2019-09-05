import React from "react";
import { Link, Redirect } from "react-router-dom";
import { useNumRegisteredContracts } from "lib/custom-hooks";

import IconSvgComponent from "components/common/IconSvgComponent";

import Header from "components/common/Header";

function Landing() {
  const numContracts = useNumRegisteredContracts();

  if (numContracts === undefined) {
    return null;
  }

  if (numContracts !== 0) {
    return <Redirect to="/ViewPositions" />;
  }

  // TODO(ptare): Add back footer once we have blog post link.
  return (
    <div className="wrapper">
      <Header />

      <div className="main">
        <div className="shell">
          <section className="section section--about">
            <h2>Synthetic Token Builder</h2>
            <div className="section__entry">
              <p>- Deploy a token facility to create risk exposure for any on-chain price index</p>

              <p>- Borrow synthetic tokens representing long price risk</p>

              <p>- Manage your short price risk through your token facility</p>
            </div>

            <Link to="/Start" className="btn">
              Get started
            </Link>
          </section>

          <section className="section section--service-items">
            <h2>Building a custom token:</h2>

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

                    <p>Borrow and sell synthetic tokens</p>
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Landing;
