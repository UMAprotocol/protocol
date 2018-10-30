
function getNewWeb3(existingWeb3) {
    var Web3 = require('web3');
    return new Web3(existingWeb3.currentProvider);
}

function convertContractToNewWeb3(newWeb3, existingContract) {
    return new newWeb3.eth.Contract(existingContract.abi, existingContract.address);
}


module.exports = {
    getNewWeb3,
    convertContractToNewWeb3
}