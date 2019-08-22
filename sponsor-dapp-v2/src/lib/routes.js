import Landing from "views/Landing.js";
import StartScreen from "views/Start.js";
import Steps from "views/Steps.js";
import ViewPositions from "views/ViewPositions.js";
import ManagePositions from "views/ManagePositions.js";
import Withdraw from "views/Withdraw.js";
import Deposit from "views/Deposit.js";
import Borrow from "views/Borrow.js";
import Repay from "views/Repay.js";

const routes = [
  { path: "/", component: Landing, exact: true },
  { path: "/Start", component: StartScreen, exact: false },
  { path: "/Steps", component: Steps, exact: false },
  { path: "/ViewPositions", component: ViewPositions, exact: false },
  { path: "/ManagePositions/:tokenAddress", component: ManagePositions, exact: false },
  { path: "/Withdraw/:tokenAddress", component: Withdraw, exact: false },
  { path: "/Deposit/:tokenAddress", component: Deposit, exact: false },
  { path: "/Borrow/:tokenAddress", component: Borrow, exact: false },
  { path: "/Repay/:tokenAddress", component: Repay, exact: false }
];

export default routes;
