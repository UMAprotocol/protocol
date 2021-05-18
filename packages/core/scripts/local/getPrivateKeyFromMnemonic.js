const bip39 = require("bip39");
const { hdkey } = require("ethereumjs-wallet");
const argv = require("minimist")(process.argv.slice(), { string: ["mnemonic"] });

const getPrivateKeyFromMnemonic = async function (callback) {
  try {
    if (!argv.mnemonic) {
      throw new Error("Must pass in --mnemonic CLI arg");
    }
    const seed = await bip39.mnemonicToSeed(argv.mnemonic);
    const hdk = hdkey.fromMasterSeed(seed);
    const addressIndex = "0";
    const addrNode = hdk.derivePath(`m/44'/60'/0'/0/${addressIndex}`); // m/44'/60'/0'/0/0 is derivation path for the first account. m/44'/60'/0'/0/1 is the derivation path for the second account and so on
    const addr = addrNode.getWallet().getAddressString(); // check that this is the same with the address that ganache list for the first account to make sure the derivation is correct
    const privateKey = addrNode.getWallet().getPrivateKeyString();

    console.log(`Public Key at index ${addressIndex}: ${addr}`);
    console.log(`- Private Key: ${privateKey}`);
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }

  callback();
};

module.exports = getPrivateKeyFromMnemonic;
