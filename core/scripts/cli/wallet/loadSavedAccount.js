const fs = require('fs');
const setDefaultAccountForWallet = require('./setDefaultAccountForWallet');

module.exports = (web3, path) => {
    try {
        fs.statSync(path);
        // Wallet exits, set it as default web3 account
        const savedAccount = JSON.parse(fs.readFileSync(path));
        setDefaultAccountForWallet(web3, savedAccount);
      } catch (err) {
        if (err.code === 'ENOENT') {}
      }
}