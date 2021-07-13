const path = require("path");
const fs = require("fs");

const { task, types } = require("hardhat/config");

task("dump-artifacts", "Admin can set generic resource ID on Bridge")
  .addParam("out", "ts file to dump the output", undefined, types.string)
  .setAction(async function (taskArguments, hre) {
    const { out } = taskArguments;

    const artifactPaths = await hre.artifacts.getArtifactPaths();

    const imports = {};
    for (const artifactPath of artifactPaths) {
      const contractName = path.basename(artifactPath).split(".")[0];
      const relativeArtifactPath = `./${path.relative(path.dirname(out), artifactPath)}`;
      imports[contractName] = {
        importLine: `import ${contractName} from "${relativeArtifactPath}";\n`,
        abiLine: `export function get${contractName}Abi(): string { return ${contractName}.abi; }\n`,
        bytecodeLine: `export function get${contractName}Bytecode(): string { return ${contractName}.bytecode; }\n`,
      };
    }

    const values = Object.values(imports);
    try {
      fs.unlinkSync(out);
    } catch (e) {
      // do nothing.
    }
    values.forEach(({ importLine }) => fs.appendFileSync(out, importLine));
    values.forEach(({ abiLine }) => fs.appendFileSync(out, abiLine));
    values.forEach(({ bytecodeLine }) => fs.appendFileSync(out, bytecodeLine));

    const dirs = fs.readdirSync("./networks");
    const addresses = {};
    for (const dir of dirs) {
      const chainId = parseInt(dir.split(".")[0]);
      const deployments = JSON.parse(fs.readFileSync(`./networks/${dir}`, "utf8"));

      // Loop over the deployments in the file and save each one.
      for (const { contractName, address, deploymentName } of deployments) {
        // If deploymentName isn't specified, use contractName.
        const saveName = deploymentName ? deploymentName : contractName;
        if (!addresses[saveName]) {
          addresses[saveName] = {};
        }
        addresses[saveName][chainId] = address;
      }
    }

    for (const [deploymentName, addressesByChain] of Object.entries(addresses)) {
      const declaration = `export function get${deploymentName}Address(chainId: number): string {\n  switch (chainId.toString()) {\n`;
      const cases = Object.entries(addressesByChain).map(([chainId, address]) => {
        return `    case "${chainId}":\n      return "${address}";\n`;
      });
      const endStatement = `    default:\n      throw new Error(\`No address found for deployment ${deploymentName} on chainId \${chainId}\`)\n  }\n}\n`;
      fs.appendFileSync(out, declaration.concat(...cases, endStatement));
    }
  });

task("load-addresses", "Load addresses from the networks folder into the hardhat deployments folder").setAction(
  async function (taskArguments, hre) {
    // Generate chain id mapping.
    const chainIdToNetworkName = {};
    for (const [name, { chainId }] of Object.entries(hre.config.networks)) {
      chainIdToNetworkName[chainId] = name;
    }

    const dirs = fs.readdirSync("./networks");
    for (const dir of dirs) {
      // Infer chainId and network name from the file we're reading.
      const chainId = parseInt(dir.split(".")[0]);
      const networkName = chainIdToNetworkName[chainId];
      if (!networkName) {
        console.error(`Skipping file ./networks/${dir} because there is no configured network for this chainId`);
      }
      // Force hardhat deployment to read the intended network name and chain id.
      hre.network.name = networkName;
      hre.getChainId = () => chainId;
      const deployments = JSON.parse(fs.readFileSync(`./networks/${dir}`, "utf8"));

      // Loop over the deployments in the file and save each one.
      for (const { contractName, address, deploymentName } of deployments) {
        // If deploymentName isn't specified, use contractName.
        const saveName = deploymentName ? deploymentName : contractName;
        const abi = hre.artifacts.readArtifactSync(contractName).abi;

        // Save the deployment using hardhat deploy's built-in function.
        await hre.deployments.save(saveName, {
          address,
          abi,
        });
      }
    }
  }
);
