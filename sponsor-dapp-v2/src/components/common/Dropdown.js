import React, { Component } from "react";
import classNames from "classnames";

import IconSvgComponent from "components/common/IconSvgComponent";

class Dropdown extends Component {
  state = {
    isOpen: false,
    labelItem: null,
    hasSelection: false
  };
  chooseItem = value => {
    this.setState(
      {
        labelItem: value,
        hasSelection: true
      },
      () => {
        this.applyChangeToParent();
      }
    );
  };
  showDropdown = () => {
    this.setState({ isOpen: true });
    document.addEventListener("click", this.hideDropdown);
  };
  hideDropdown = () => {
    this.setState({ isOpen: false });
    document.removeEventListener("click", this.hideDropdown);
  };

  applyChangeToParent = () => {
    this.props.onChange(this.state.hasSelection);
  };

  componentDidMount() {
    const label = this.props.placeholder ? this.props.placeholder : this.props.list[0];
    this.setState({
      labelItem: label
    });
  }

  render() {
    const { list } = this.props;

    const dropdownClasses = classNames(
      "dropdown",
      { [`${this.props.customClass}`]: this.props.customClass },
      { open: this.state.isOpen },
      { "has-value": this.state.hasSelection }
    );

    return (
      <div className={dropdownClasses}>
        <button className="dropdown__toggle" type="button" onClick={this.showDropdown}>
          {this.state.labelItem}

          <span className="icon">
            <IconSvgComponent iconPath="svg/ico-arrow-down.svg" additionalClass="ico-arrow-down" />
          </span>
        </button>
        <ul className="dropdown__menu">
          {list.map((item, index) => {
            return (
              <li
                key={index}
                value={index}
                className={classNames({
                  active: this.state.labelItem === item
                })}
                onClick={() => this.chooseItem(item)}
              >
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
}

export default Dropdown;
