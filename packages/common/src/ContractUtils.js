const truffleContract = require("@truffle/contract");

/**
 * This is a hack to handle reverts for view/pure functions that don't actually revert on public networks.
 * See https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211 for more
 * info.
 * @param {Object} result Return value from calling a contract's view-only method.
 * @return null if the call reverted or the view method's result.
 */
const revertWrapper = (result) => {
  if (!result) {
    return null;
  }
  let revertValue = "3963877391197344453575983046348115674221700746820753546331534351508065746944";
  if (result.toString() === revertValue) {
    return null;
  }
  const isObject = (obj) => {
    return obj === Object(obj);
  };
  if (isObject(result)) {
    // Iterate over the properties of the object and see if any match the revert value.
    for (let prop in result) {
      if (result[prop] && result[prop].toString() === revertValue) {
        return null;
      }
    }
  }
  return result;
};

/**
 * create a truffle contract from a json object, usually read in from an artifact.
 * @param {*} contractJsonObject json object representing a contract.
 * @param {Object} web3 instance. In unit tests this is globally accessable but when used in production needs injection.
 * @returns truffle contract instance
 */
const createContractObjectFromJson = (contractJsonObject, _web3 = web3) => {
  let truffleContractCreator = truffleContract(contractJsonObject);
  truffleContractCreator.setProvider(_web3.currentProvider);
  return truffleContractCreator;
};
/**
 * Helper to enable enables library linking on artifacts that were not compiled within this repo, such as artifacts
 * produced by an external project. Can also be useful if the artifact was compiled using ethers.
 * @param {object} artifact representing the compiled contract instance.
 * @param {string} libraryName to be found and replaced within the artifact.
 * @returns
 */
const replaceLibraryBindingReferenceInArtitifact = (artifact, libraryName) => {
  const artifactString = JSON.stringify(artifact);
  return JSON.parse(artifactString.replace(/\$.*\$/g, libraryName));
};

module.exports = { revertWrapper, createContractObjectFromJson, replaceLibraryBindingReferenceInArtitifact };
