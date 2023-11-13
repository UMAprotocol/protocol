const { assert } = require("chai");
const { bigNumberFormatter } = require("../../dist/logger/Formatters.js");
const { BigNumber } = require("ethers");
const Web3 = require("web3");
const { toBN } = Web3.utils;
const { cloneDeep } = require("lodash");

describe("BigNumberFormatter", function () {
  it("Should replace all BigNumbers", function () {
    const sample = {
      bn1: BigNumber.from(10),
      nested: { bn2: BigNumber.from(100), doubleNested: { bn3: toBN("1000") } },
    };

    assert.deepEqual(bigNumberFormatter(sample), { bn1: "10", nested: { bn2: "100", doubleNested: { bn3: "1000" } } });
  });

  it("Non BNs are not modified and the original object is not changed", function () {
    const sample = { val: null, nested: { val: 100, doubleNested: { val: undefined }, val2: "1000" } };

    const shallowCopy = sample;
    const deepCopy = cloneDeep(sample);

    const output = bigNumberFormatter(sample);

    // All references and values should be unchanged.
    assert.deepEqual(output, deepCopy);
    assert.equal(output, shallowCopy);
    assert.equal(shallowCopy, sample);
  });

  it("Only parts of the object that involve BNs are deep copied", function () {
    const sample = {
      val: null,
      nested: { val: 100, doubleNested: { val: undefined }, val2: "1000" },
      nested2: { val: BigNumber.from(100), doubleNested: { val: undefined }, val2: toBN("1000") },
    };

    const shallowCopy = sample;
    const deepCopy = cloneDeep(sample);
    const nestedShallowCopy = sample.nested;
    const nestedDeepCopy = cloneDeep(sample.nested);
    const nested2ShallowCopy = sample.nested2;
    const nested2DeepCopy = cloneDeep(sample.nested2);

    const output = bigNumberFormatter(sample);

    // The BigNumbers/BNs should have been coverted correctly.
    assert.deepEqual(output, {
      val: null,
      nested: { val: 100, doubleNested: { val: undefined }, val2: "1000" },
      nested2: { val: "100", doubleNested: { val: undefined }, val2: "1000" },
    });

    // The nested sub-object should still be the same reference and should not have been modified.
    assert.equal(output.nested, nestedShallowCopy);
    assert.deepEqual(output.nested, nestedDeepCopy);

    // The nested2 sub-object contained BNs so it should not be the same reference and the original reference shouldn't
    // be modified.
    assert.notEqual(output.nested2, nested2ShallowCopy);
    assert.notDeepEqual(output.nested2, nested2DeepCopy);
    assert.deepEqual(nested2ShallowCopy, nested2DeepCopy);

    // The top level object contained BNs so it should not be the same reference and the original reference shouldn't
    // be modified.
    assert.notEqual(output, shallowCopy);
    assert.notDeepEqual(output, deepCopy);
    assert.deepEqual(shallowCopy, deepCopy);
  });
});
