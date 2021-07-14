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

task("generate-ts", "Admin can set generic resource ID on Bridge")
  .addParam("browser", "browser ts output file", undefined, types.string)
  .addParam("nodejs", "nodejs ts output file", undefined, types.string)
  .setAction(async function (taskArguments, hre) {
    const { browser: browserOutfile, nodejs: nodejsOutfile } = taskArguments;

    removeFileIfExists(browserOutfile);
    removeFileIfExists(nodejsOutfile);

    const artifactPaths = await hre.artifacts.getArtifactPaths();

    // Generate a unique list of artifacts and paths to them. Unique is necessary because there are some redundantly
    // named contracts.
    const artifacts = uniqBy(
      artifactPaths.map((artifactPath) => ({
        contractName: path.basename(artifactPath).split(".")[0],
        browserRelativePath: `./${path.relative(path.dirname(browserOutfile), artifactPath)}`,
        nodejsRelativePath: `./${path.relative(path.dirname(nodejsOutfile), artifactPath)}`,
      })),
      "contractName"
    );

    // Generate a map of name => chain id => address.
    const dirs = fs.readdirSync("./networks");
    const addresses = {};
    for (const dir of dirs) {
      const chainId = parseInt(dir.split(".")[0]);
      const deployments = JSON.parse(fs.readFileSync(`./networks/${dir}`, "utf8"));

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

    // Write abi and bytecode for the browser file.
    // Note: the idea behind writing the functions this way is to make them as optimized as possible for tree-shaking
    // to remove any unused json files. In modern versions of webpack, this should allow absolutely _no_ artifact
    // information that isn't needed to be pulled in.
    artifacts.forEach(({ contractName, browserRelativePath }) =>
      fs.appendFileSync(
        browserOutfile,
        `import { abi as ${contractName}Abi, bytecode as ${contractName}Bytecode } from "${browserRelativePath}";\n`
      )
    );
    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(
        browserOutfile,
        `export function get${contractName}Abi(): any[] { return ${contractName}Abi; }\n`
      )
    );
    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(
        browserOutfile,
        `export function get${contractName}Bytecode(): string { return ${contractName}Bytecode; }\n`
      )
    );

    // Completely disable general getAbi and getBytecode functions in the browser to avoid the possibility of bunding all artifacts.
    fs.appendFileSync(
      browserOutfile,
      "export function getAbi(contractName: string): any[] { throw new Error(`Must call get${contractName}Abi() in browser.`); }\n"
    );
    fs.appendFileSync(
      browserOutfile,
      "export function getBytecode(contractName: string): string { throw new Error(`Must call get${contractName}Bytecode() in browser.`); }\n"
    );

    // Write abi and bytecode for the nodejs file.
    fs.appendFileSync(nodejsOutfile, "const artifactPaths = {\n");
    artifacts.forEach(({ contractName, nodejsRelativePath }) =>
      fs.appendFileSync(nodejsOutfile, `  ${contractName}: "${nodejsRelativePath}",\n`)
    );
    fs.appendFileSync(nodejsOutfile, "};\n");
    fs.appendFileSync(
      nodejsOutfile,
      "export function getAbi(contractName: string): any[] { return require(artifactPaths[contractName]).abi; }\n"
    );
    fs.appendFileSync(
      nodejsOutfile,
      "export function getBytecode(contractName: string): string { return require(artifactPaths[contractName]).bytecode; }\n"
    );

    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(
        nodejsOutfile,
        `export function get${contractName}Abi(): string { return require(artifactPaths["${contractName}"]).abi; }\n`
      )
    );
    artifacts.forEach(({ contractName }) =>
      fs.appendFileSync(
        nodejsOutfile,
        `export function get${contractName}Bytecode(): string { return require(artifactPaths["${contractName}"]).bytecode; }\n`
      )
    );

    // Creates get[name]Address(chainId) for node and browser using switch statements.
    for (const [name, addressesByChain] of Object.entries(addresses)) {
      const declaration = `export function get${name}Address(chainId: number): string {\n  switch (chainId.toString()) {\n`;
      const cases = Object.entries(addressesByChain).map(([chainId, address]) => {
        return `    case "${chainId}":\n      return "${address}";\n`;
      });
      const endStatement = `    default:\n      throw new Error(\`No address found for deployment ${name} on chainId \${chainId}\`)\n  }\n}\n`;
      fs.appendFileSync(browserOutfile, declaration.concat(...cases, endStatement));
      fs.appendFileSync(nodejsOutfile, declaration.concat(...cases, endStatement));
    }

    // Stubs the getAddress(name, chainId) function in browser by throwing when called.
    fs.appendFileSync(
      browserOutfile,
      `export function getAddress(name: string, chainId: number): string {
  throw new Error(\`getAddress not available in browser, please call get\${name}Address(\${chainId}) instead\`);
}\n`
    );

    // Constructs a mapping of name to address function for nodejs.
    fs.appendFileSync(nodejsOutfile, "const addressFunctions = {\n");
    Object.keys(addresses).forEach((name) => fs.appendFileSync(nodejsOutfile, `  ${name}: get${name}Address,\n`));
    fs.appendFileSync(nodejsOutfile, "};\n");

    // Creates a getAddress(name, chainId) function in nodejs that routes to the right get[name]Address function using
    // the above mapping.
    fs.appendFileSync(
      nodejsOutfile,
      `export function getAddress(name: string, chainId: number): string {
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
