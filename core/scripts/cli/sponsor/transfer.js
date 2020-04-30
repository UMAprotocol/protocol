const inquirer = require("inquirer");
const getDefaultAccount = require("../wallet/getDefaultAccount");
const { submitTransaction } = require("./transactionUtils");

const transfer = async (web3, emp) => {
  const { fromWei, isAddress, toBN } = web3.utils;
  const sponsorAddress = await getDefaultAccount(web3);
  const position = await emp.positions(sponsorAddress);

  // Cancel pending transfer.
  const cancelTransfer = async () => {
    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: "Continue?",
      default: false,
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      await submitTransaction(web3, async () => await emp.cancelTransferPosition(), "Cancelling pending transfer");
    }
  };

  // Execute pending transfer.
  const executeTransfer = async () => {
    const input = await inquirer.prompt({
      name: "address",
      message: "Which address would you like to transfer to?",
      validate: value => isAddress(value) || "Invalid address"
    });

    const targetCollateral = (await emp.getCollateral(input["address"])).toString();
    if (targetCollateral !== "0") {
      console.log(
        `Target address already has ${fromWei(targetCollateral)} WETH. Can only transfer to an owner without a position`
      );
      return;
    }

    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: `Transferring to ${input["address"]}. This cannot be reversed!`,
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      await emp.transferPositionPassedRequest(input["address"]);
    }
  };

  // First check if user has a transfer request pending.
  const transferPositionRequestPassedTimestamp = position.transferPositionRequestPassTimestamp;
  if (transferPositionRequestPassedTimestamp.toString() !== "0") {
    const currentTime = await emp.getCurrentTime();

    // Get current contract time and transfer request expiration time.
    const currentTimeReadable = new Date(Number(currentTime.toString()) * 1000);
    const expirationTimeReadable = new Date(Number(transferPositionRequestPassedTimestamp.toString()) * 1000);

    // Transfer request is still pending. User can cancel transfer.
    if (toBN(transferPositionRequestPassedTimestamp.toString()).gt(toBN(currentTime.toString()))) {
      console.log(`You have a transfer request that is pending until ${expirationTimeReadable}.`);
      console.log(`The current contract time is ${currentTimeReadable}.`);
      const prompt = {
        type: "list",
        name: "choice",
        message: "What would you like to do?",
        choices: ["Back", "Cancel Pending Transfer"]
      };
      const input = (await inquirer.prompt(prompt))["choice"];
      switch (input) {
        case "Cancel Pending Transfer":
          await cancelTransfer();
          break;
        case "Back":
          return;
        default:
          console.log("unimplemented state");
      }
    }
    // Transfer request has passed, user can transfer or cancel.
    else {
      // Executing transfer requests can only occur if there are no pending withdrawals.
      const hasPendingWithdrawal = position.requestPassTimestamp.toString() !== "0";

      if (hasPendingWithdrawal) {
        console.log(
          `Your transfer request has been ready since ${expirationTimeReadable} but you cannot execute it until your pending withdrawal is processed.`
        );
      } else {
        console.log(`Your transfer request has been ready since ${expirationTimeReadable}.`);
      }

      console.log(`The current contract time is ${currentTimeReadable}.`);
      const prompt = {
        type: "list",
        name: "choice",
        message: "What would you like to do?",
        choices: ["Back", "Cancel Pending Transfer"]
      };

      if (!hasPendingWithdrawal) {
        prompt.choices.push("Execute Pending Transfer");
      }

      const input = (await inquirer.prompt(prompt))["choice"];
      switch (input) {
        case "Execute Pending Transfer":
          await executeTransfer();
          break;
        case "Cancel Pending Transfer":
          await cancelTransfer();
          break;
        case "Back":
          return;
        default:
          console.log("unimplemented state");
      }
    }
  } else {
    const transferLiveness = await emp.withdrawalLiveness();
    const transferLivenessInMinutes = toBN(transferLiveness.toString())
      .div(toBN(60))
      .toString();

    console.log(
      `You must request a transfer to change the sponsor address of the position. The request takes ${transferLivenessInMinutes} minutes to process. Once the request is processed, you can specify the new sponsor address. You can also cancel your transfer at any time.`
    );

    // No transfers can be processed instantly, call `requestTransferPosition()`
    const confirmation = await inquirer.prompt({
      type: "confirm",
      message: "Continue?",
      name: "confirm"
    });
    if (confirmation["confirm"]) {
      await submitTransaction(web3, async () => await emp.requestTransferPosition(), "Requesting transfer");
      console.log(
        `Transfer requested. Come back in ${transferLivenessInMinutes} minutes to execute your transfer to another sponsor address.`
      );
    }
  }
};

module.exports = transfer;
