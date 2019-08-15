import React, { Component } from "react";
import IconSvgComponent from "components/common/IconSvgComponent";
import { Link } from "react-router-dom";

class Header extends Component {
  render() {
    return (
      <div className="header">
        <div className="shell">
          <Link to="/" className="logo">
            <IconSvgComponent iconPath="svg/logo.svg" additionalClass="logo-icon" />
          </Link>
        </div>
      </div>
    );
  }
}

export default Header;
