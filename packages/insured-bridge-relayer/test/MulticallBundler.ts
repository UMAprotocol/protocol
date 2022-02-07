import { SpyTransport, GasEstimator } from "@uma/financial-templates-lib";
import { MultiCallerTestWeb3 } from "@uma/contracts-node";
import winston from "winston";
import sinon, { SinonSpy } from "sinon";
import hre from "hardhat";
import { assert } from "chai";
import { MulticallBundler } from "../src/MulticallBundler";
import { HRE, TransactionType } from "@uma/common";

const { web3, getContract } = hre as HRE;
const Multicaller = getContract("MultiCallerTest");

describe("MulticallBundler.ts", function () {
  let spyLogger: winston.Logger | undefined;
  let spy: SinonSpy | undefined;
  let gasEstimator: GasEstimator | undefined;
  let owner = "";
  let multicallBundler: MulticallBundler | undefined;
  let multicaller: MultiCallerTestWeb3 | undefined;

  const txnCast = <T>(input: T) => (input as unknown) as TransactionType;

  before(async function () {
    [owner] = await web3.eth.getAccounts();
  });

  beforeEach(async function () {
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });

    gasEstimator = new GasEstimator(spyLogger!);

    multicallBundler = new MulticallBundler(spyLogger!, gasEstimator, web3, owner);

    multicaller = ((await Multicaller.new().send({ from: owner })) as unknown) as MultiCallerTestWeb3;
  });
  it("Sends single transaction", async function () {
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });
    await multicallBundler!.send();
    await multicallBundler!.waitForMine();
    assert.equal((await multicaller!.methods.value().call()).toString(), "1");
  });

  it("Sends multiple transactions", async function () {
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });
    await multicallBundler!.send();
    await multicallBundler!.waitForMine();
    assert.equal((await multicaller!.methods.value().call()).toString(), "2");
  });

  it("Handles single transaction failure", async function () {
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.call(true)) });
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });

    await multicallBundler!.send();
    await multicallBundler!.waitForMine();
    assert.equal((await multicaller!.methods.value().call()).toString(), "2");
  });

  it("Transactions not sent until send is called", async function () {
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });
    multicallBundler!.addTransactions({ transaction: txnCast(multicaller!.methods.add("1")) });

    assert.equal((await multicaller!.methods.value().call()).toString(), "0");
    await multicallBundler!.send();
    await multicallBundler!.waitForMine();
  });
});
