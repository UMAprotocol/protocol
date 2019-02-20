import React from "react";
import Button from "@material-ui/core/Button";

const ContractInteraction = ({ remarginFn, depositFn, withdrawFn, createFn, redeemFn }) => (
  <div>
    <Button onClick={remarginFn}>Remargin contract</Button>
    <Button onClick={depositFn}>Deposit</Button>
    <Button onClick={withdrawFn}>Withdraw</Button>
    <Button onClick={createFn}>Create</Button>
    <Button onClick={redeemFn}>Redeem</Button>
  </div>
);

export default ContractInteraction;
