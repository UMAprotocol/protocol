const path = require("path");
const fs = require("fs");
const uniqBy = require("lodash.uniqby");

const { task, types } = require("hardhat/config");

function removeFileIfExists(filename) {
  try {
    fs.unlinkSync(filename);
  } catch (e) {
    // do nothing.
  }
}

async function getArtifactPathList(hre, relativeTo) {
  const artifactPaths = await hre.artifacts.getArtifactPaths();

  // Generate a unique list of artifacts and paths to them. Unique is necessary because there are some redundantly
  // named contracts.
  return uniqBy(
    artifactPaths.map((artifactPath) => ({
      contractName: path.basename(artifactPath).split(".")[0],
      relativePath: `./${path.relative(path.dirname(relativeTo), artifactPath)}`,
    })),
    "contractName"
  );
}

function getCorePath(hre, relativeTo) {
  const artifactPath = hre.config.paths.artifacts ? path.join(hre.config.paths.artifacts, "../") : "./";
  return `./${path.relative(relativeTo, artifactPath)}`;
}

function getAddressesMap(hre) {
  // Generate a map of name => chain id => address.
  const networksPath = path.join(getCorePath(hre, "./"), "networks");
  const dirs = fs.readdirSync(networksPath);
  const addresses = {};
  for (const dir of dirs) {
    const chainId = parseInt(dir.split(".")[0]);
    const deployments = JSON.parse(fs.readFileSync(path.join(networksPath, dir), "utf8"));

    // Loop over the deployments in the file and save each one.
    for (const { contractName, address, deploymentName } of deployments) {
      // If deploymentName isn't specified, use contractName.
      const name = deploymentName ? deploymentName : contractName;
      if (!addresses[name]) {
        addresses[name] = {};
      }
      addresses[name][chainId] = address;
    }
  }
  return addresses;
}

task("generate-contracts-frontend", "Generate typescipt for the contracts-frontend package")
  .addParam("out", "browser ts output file", undefined, types.string)
  .setAction(async function (taskArguments, hre) {
    const { out } = taskArguments;
    removeFileIfExists(out);

    const artifacts = await getArtifactPathList(hre, out);
    const addresses = getAddressesMap(hre);

    // Write Ethers contract types/factories export.
    fs.appendFileSync(out, 'export * as EthersContracts from "../typechain/ethers";\n');

    // Write abi and bytecode for the browser file.
    // Note: the idea behind writing the functions this way is to make them as optimized as possible for tree-shaking
    // to remove any unused json files. In modern versions of webpack, this should allow absolutely _no_ artifact
    // information that isn't needed to be pulled in.
    artifacts.forEach(({ contractName, relativePath }) =>
      fs.appendFileSync(
        out,
        `import { abi as ${contractName}Abi, bytecode as ${contractName}Bytecode } from "${relativePath}";\n`
      )
    );
    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(out, `export function get${contractName}Abi(): any[] { return ${contractName}Abi; }\n`)
    );
    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(
        out,
        `export function get${contractName}Bytecode(): string { return ${contractName}Bytecode; }\n`
      )
    );

    // Creates get[name]Address(chainId) for using switch statements.
    for (const [name, addressesByChain] of Object.entries(addresses)) {
      const declaration = `export function get${name}Address(chainId: number): string {\n  switch (chainId.toString()) {\n`;
      const cases = Object.entries(addressesByChain).map(([chainId, address]) => {
        return `    case "${chainId}":\n      return "${address}";\n`;
      });
      const endStatement = `    default:\n      throw new Error(\`No address found for deployment ${name} on chainId \${chainId}\`)\n  }\n}\n`;
      fs.appendFileSync(out, declaration.concat(...cases, endStatement));
    }
  });

task("generate-contracts-node", "Generate typescipt for the contracts-node package")
  .addParam("out", "node ts output file", undefined, types.string)
  .setAction(async function (taskArguments, hre) {
    const { out } = taskArguments;
    removeFileIfExists(out);

    const artifacts = await getArtifactPathList(hre, out);
    const addresses = getAddressesMap(hre);

    // Write Ethers contract types/factories export.
    fs.appendFileSync(out, 'export * as EthersContracts from "../typechain/ethers";\n');

    // Write abi and bytecode for the nodejs file.
    // Write an object that maps artifacts to their paths.
    fs.appendFileSync(out, "const artifactPaths = {\n");
    artifacts.forEach(({ contractName, relativePath }) =>
      fs.appendFileSync(out, `  ${contractName}: "${relativePath}",\n`)
    );
    fs.appendFileSync(out, "};\n");
    fs.appendFileSync(out, "type ContractName = keyof typeof artifactPaths;\n");

    // Use object to import the correct artifact for each contract name and return to the user.
    fs.appendFileSync(
      out,
      "export function getAbi(contractName: ContractName): any[] { return require(artifactPaths[contractName]).abi; }\n"
    );
    fs.appendFileSync(
      out,
      "export function getBytecode(contractName: ContractName): string { return require(artifactPaths[contractName]).bytecode; }\n"
    );

    // Creates get[name]Address(chainId) using switch statements.
    // Note: don't export these functions as they are only used internally.
    for (const [name, addressesByChain] of Object.entries(addresses)) {
      const declaration = `function get${name}Address(chainId: number): string {\n  switch (chainId.toString()) {\n`;
      const cases = Object.entries(addressesByChain).map(([chainId, address]) => {
        return `    case "${chainId}":\n      return "${address}";\n`;
      });
      const endStatement = `    default:\n      throw new Error(\`No address found for deployment ${name} on chainId \${chainId}\`)\n  }\n}\n`;
      fs.appendFileSync(out, declaration.concat(...cases, endStatement));
    }

    // Constructs a mapping of name to address function for nodejs.
    fs.appendFileSync(out, "const addressFunctions = {\n");
    Object.keys(addresses).forEach((name) => fs.appendFileSync(out, `  ${name}: get${name}Address,\n`));
    fs.appendFileSync(out, "};\n");
    fs.appendFileSync(out, "type DeploymentName = keyof typeof addressFunctions;\n");

    // Creates a getAddress(name, chainId) function in nodejs that routes to the right get[name]Address function using
    // the above mapping.
    fs.appendFileSync(
      out,
      `export function getAddress(name: DeploymentName, chainId: number): string {
  const fn = addressFunctions[name];
  if (!fn) throw new Error(\`No deployments for name: \${name}\`);
  return fn(chainId);
}
`
    );
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
