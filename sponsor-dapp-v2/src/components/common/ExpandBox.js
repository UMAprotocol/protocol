import React, { Component } from "react";
import classNames from "classnames";
import moment from "moment";

import IconSvgComponent from "components/common/IconSvgComponent";

class ExpandBox extends Component {
  state = {
    isActive: false
  };
  toggleExpand = () => {
    this.setState({ isActive: !this.state.isActive });
  };

  render() {
    const expandBoxClasses = classNames("expand-box", {
      active: this.state.isActive
    });

    const convertTimestamp = timestamp => {
      return moment.unix(timestamp).format("YYYY-MM-DD, HH:MM:SS");
    };

    const convertAddress = address => {
      const startAddress = address.slice(0, 7);
      const endAddress = address.slice(-1);

      return `${startAddress}...${endAddress}`;
    };

    return (
      <div className={expandBoxClasses}>
        <button className="expand-box__trigger" type="button" onClick={this.toggleExpand}>
          <strong>{this.props.title}</strong>

          <span className="icon">
            <IconSvgComponent iconPath="svg/ico-arrow-down-dark.svg" additionalClass="ico-arrow-down" />
          </span>
        </button>

        <div className="expand-box__body">
          <div className="expand-box__content">
            <ul>
              {this.props.content.map((item, itemIndex) => {
                if (item.type === "timestamp") {
                  return (
                    <li key={`detail-${itemIndex}`}>
                      {item.title}: {convertTimestamp(item.timestamp)}
                    </li>
                  );
                }

                if (item.type === "address") {
                  return (
                    <li key={`detail-${itemIndex}`}>
                      {item.title}: {convertAddress(item.address.display)}
                    </li>
                  );
                }

                if (item.type === "namedAddress") {
                  return (
                    <li key={`detail-${itemIndex}`}>
                      {item.title}: {item.name} ({convertAddress(item.address.display)})
                    </li>
                  );
                }
                return <li key={`detail-${itemIndex}`}>No Data</li>;
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  }
}

export default ExpandBox;
