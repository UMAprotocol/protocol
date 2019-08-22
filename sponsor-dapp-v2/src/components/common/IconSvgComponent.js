/**
 * @ External Dependencies
 */
import React from "react";
import ReactSVG from "react-svg";

const IconSvgComponent = ({ iconPath, additionalClass }) => {
  let classAddition = "";

  if (additionalClass !== undefined) {
    classAddition = additionalClass;
  } else {
    classAddition = "";
  }

  return <ReactSVG src={process.env.PUBLIC_URL.concat("/", iconPath)} className={`svg-icon ${classAddition}`} />;
};

export default IconSvgComponent;
