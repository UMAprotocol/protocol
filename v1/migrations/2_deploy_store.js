const Store = artifacts.require("Store.js");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

	module.exports = async function(deployer, network, accounts) {
		const keys = getKeysForNetwork(network, accounts);

		const store = await deployAndGet(deployer, Store, { from: keys.store});,
		await addToTdr(store, network);

		//TODO set oracle fees & constants
		const secondsPerYear = 31536000;

	};
