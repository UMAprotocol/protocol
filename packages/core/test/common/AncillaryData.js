const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");

const AncillaryDataTest = getContract("AncillaryDataTest");
const { utf8ToHex } = web3.utils;

contract("AncillaryData", function (accounts) {
  let ancillaryDataTest;
  beforeEach(async function () {
    await runDefaultFixture(hre);
    ancillaryDataTest = await AncillaryDataTest.new().send({ from: accounts[0] });
  });

  it("toUtf8BytesAddress", async function () {
    const utf8EncodedAddress = await ancillaryDataTest.methods
      .toUtf8BytesAddress(ancillaryDataTest.options.address)
      .call();
    assert.equal(
      utf8EncodedAddress,
      utf8ToHex(ancillaryDataTest.options.address.substr(2).toLowerCase()),
      "Should strip leading 0x and return in all lower case"
    );
  });

  it("toUtf8BytesUint", async function () {
    const utf8EncodedUint = await ancillaryDataTest.methods.toUtf8BytesUint("31337").call();
    assert.equal(utf8EncodedUint, utf8ToHex("31337"));
  });

  it("_appendKey", async function () {
    const keyName = utf8ToHex("key");
    let originalAncillaryData;

    // Test 1: ancillary data is empty
    originalAncillaryData = "0x";
    assert.equal(
      await ancillaryDataTest.methods.appendKey(originalAncillaryData, keyName).send({ from: accounts[0] }),
      utf8ToHex("key:"),
      "Should return key: with no leading comma"
    );

    // Test 2: ancillary data is not empty
    originalAncillaryData = "0xab";
    assert.equal(
      await ancillaryDataTest.methods.appendKey(originalAncillaryData, keyName).send({ from: accounts[0] }),
      utf8ToHex(",key:"),
      "Should return key: with leading comma"
    );
  });

  it("appendKeyValueAddress", async function () {
    let originalAncillaryData, appendedAncillaryData;
    const keyName = utf8ToHex("address");
    const value = ancillaryDataTest.options.address;
    const keyValueLengthBytes = 9 + 40; // "," + "address:" + <address> = 1 + 8 + 49 bytes.

    // Test 1: append AFTER ancillary data:
    originalAncillaryData = utf8ToHex("key:value");
    assert.equal(
      await ancillaryDataTest.methods
        .appendKeyValueAddress(originalAncillaryData, keyName, value)
        .send({ from: accounts[0] }),
      utf8ToHex(`key:value,address:${value.substr(2).toLowerCase()}`),
      "Should append key:valueAddress to original ancillary data"
    );

    // Test 2: ancillary data is not utf8 decodeable:
    originalAncillaryData = "0xab";
    appendedAncillaryData = await ancillaryDataTest.methods
      .appendKeyValueAddress(originalAncillaryData, keyName, value)
      .call();
    assert.equal(
      "0x" + appendedAncillaryData.substr(appendedAncillaryData.length - keyValueLengthBytes * 2),
      utf8ToHex(`,address:${value.substr(2).toLowerCase()}`),
      "Should be able to decode appended ancillary data after stripping out non-utf8 decodeable component"
    );

    // Test 3: ancillary data is utf8 decodeable but not key:value syntax:
    originalAncillaryData = utf8ToHex("ignore this syntax");
    assert.equal(
      await ancillaryDataTest.methods
        .appendKeyValueAddress(originalAncillaryData, keyName, value)
        .send({ from: accounts[0] }),
      utf8ToHex(`ignore this syntax,address:${value.substr(2).toLowerCase()}`),
      "Should be able to utf8-decode the entire ancillary data"
    );
  });
  it("appendKeyValueUint", async function () {
    let originalAncillaryData = utf8ToHex("key:value");
    let appendedAncillaryData;
    const keyName = utf8ToHex("chainId");
    const value = "31337";
    const keyValueLengthBytes = 9 + value.length; // "," + "chainId:" + "31337" = 1 + 8 + 5 = 14 bytes.

    // Test 1: append AFTER ancillary data:
    assert.equal(
      await ancillaryDataTest.methods
        .appendKeyValueUint(originalAncillaryData, keyName, value)
        .send({ from: accounts[0] }),
      utf8ToHex("key:value,chainId:31337"),
      "Should append chainId:<chainId> to original ancillary data"
    );

    // Test 2: ancillary data is not utf8 decodeable:
    originalAncillaryData = "0xab";
    appendedAncillaryData = await ancillaryDataTest.methods
      .appendKeyValueUint(originalAncillaryData, keyName, value)
      .call();
    assert.equal(
      "0x" + appendedAncillaryData.substr(appendedAncillaryData.length - keyValueLengthBytes * 2),
      utf8ToHex(`,chainId:${value}`),
      "Should be able to decode appended ancillary data after stripping out non-utf8 decodeable component"
    );

    // Test 3: ancillary data is utf8 decodeable but not key:value syntax:
    originalAncillaryData = utf8ToHex("ignore this syntax");
    assert.equal(
      await ancillaryDataTest.methods
        .appendKeyValueUint(originalAncillaryData, keyName, value)
        .send({ from: accounts[0] }),
      utf8ToHex(`ignore this syntax,chainId:${value}`),
      "Should be able to utf8-decode the entire ancillary data"
    );
  });
});
