const fs = require("fs");
const style = require("../textStyle");

module.exports = (newAccountPath, newAccount) => {
  try {
    fs.writeFileSync(newAccountPath, JSON.stringify(newAccount));
    console.log(
      `Saved new Ethereum account to ${style.bgGreen(newAccountPath)} with public key: ${style.bgRed(
        newAccount.address
      )}`
    );
    return newAccount;
  } catch (err) {
    console.error(`Failed to save new Ethereum wallet to  ${newAccountPath}`, err);
  }
};
