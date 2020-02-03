const fs = require("fs");

// If .uma directory for storing voting wallets does not exist,
// then create it for user
module.exports = path => {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path);
  }
  const walletDirectory = `${path}/wallet_data`;
  if (!fs.existsSync(walletDirectory)) {
    fs.mkdirSync(walletDirectory);
  }
  return walletDirectory;
};
