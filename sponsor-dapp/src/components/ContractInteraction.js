import React from "react";
import Button from "@material-ui/core/Button";

const ContractInteraction = ({ remarginFn }) => (
  <div>
    <Button onClick={remarginFn}>Remargin contract</Button>
  </div>
);

export default ContractInteraction;
