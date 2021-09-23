const argv = require("minimist")(process.argv.slice(), { string: ["contract", "role_id", "address"] });

const MultiRole = artifacts.require("MultiRole");

const addMemberToRole = async function (callback) {
  try {
    const roleManager = (await web3.eth.getAccounts())[0];

    // Initialize the MultiRole interface from the provided address.
    const multiRole = await MultiRole.at(argv.contract);

    // Add the new member.
    await multiRole.addMember(argv.role_id, argv.address, { from: roleManager });

    console.log(`Added ${argv.address} to role id ${argv.role_id} to MultiRole contract at ${argv.contract}`);
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }

  callback();
};

module.exports = addMemberToRole;
