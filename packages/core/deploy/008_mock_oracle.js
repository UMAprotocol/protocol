const { ZERO_ADDRESS } = require("@uma/common")

const func = async function(hre) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
  
    const { deployer } = await getNamedAccounts();

    const Finder = await deployments.get('Finder')

    const args = [
        Finder.address,
        ZERO_ADDRESS
    ]
    await deploy("MockOracleAncillary", {
      from: deployer,
      args,
      log: true
    });
  };
  module.exports = func;
  func.tags = ["MockOracle"];
  func.dependencies = ['Finder']; 
