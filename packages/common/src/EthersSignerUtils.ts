const args = require("minimist")(process.argv.slice(2));
import { Wallet } from "ethers";
import { getGckmsConfig } from "./gckms/GckmsConfig";
import { retrieveGckmsKeys } from "./gckms/utils";

export async function getEthersSigner(): Promise<Wallet> {
  if (!Object.keys(args).includes("wallet")) throw new Error("Must define mnemonic, privatekey or gckms for wallet");
  if (args.wallet === "mnemonic") return getMnemonicSigner();
  if (args.wallet === "privateKey") return getPrivateKeySigner();
  if (args.wallet === "gckms") return await getGckmsSigner();
  throw new Error("Invalid wallet type");
}

function getPrivateKeySigner() {
  if (!process.env.PRIVATE_KEY) throw new Error(`Wallet private key selected but no PRIVATE_KEY env set!`);
  return new Wallet(process.env.PRIVATE_KEY);
}

export async function getGckmsSigner(selectedWallet?: string): Promise<Wallet> {
  if (!args.keys && !selectedWallet)
    throw new Error(`Wallet GCKSM selected but no keys parameter set or selectedWallet! Set any of them first`);
  const privateKeys = await retrieveGckmsKeys(getGckmsConfig([args.keys ?? selectedWallet]));
  return new Wallet(privateKeys[0]); // GCKMS retrieveGckmsKeys returns multiple keys. For now we only support 1.
}

function getMnemonicSigner() {
  if (!process.env.MNEMONIC) throw new Error(`Wallet mnemonic selected but no MNEMONIC env set!`);
  return Wallet.fromMnemonic(process.env.MNEMONIC);
}
