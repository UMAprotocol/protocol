import path from "path";
import fs from "fs";
import uniqBy from "lodash.uniqby";
import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CombinedHRE } from "./types";

function removeFileIfExists(filename: string): void {
  try {
    fs.unlinkSync(filename);
  } catch (e) {
    // do nothing.
  }
}

function normalizeClassName(name: string): string {
  const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1); // Capitalize first letter.
  return capitalizedName.replace(/_/g, ""); // Remove underscores.
}

async function getArtifactPathList(hre: HardhatRuntimeEnvironment, relativeTo: string) {
  const artifactPaths = await hre.artifacts.getArtifactPaths();

  // Generate a unique list of artifacts and paths to them. Unique is necessary because there are some redundantly
  // named contracts.
  return uniqBy(
    artifactPaths.map((artifactPath: string) => ({
      contractName: path.basename(artifactPath).split(".")[0],
      relativePath: `./${path.relative(path.dirname(relativeTo), artifactPath)}`,
    })),
    "contractName"
  );
}

function getCorePath(hre: HardhatRuntimeEnvironment, relativeTo: string): string {
  const artifactPath = hre.config.paths.artifacts ? path.join(hre.config.paths.artifacts, "../") : "./";
  return `./${path.relative(relativeTo, artifactPath)}`;
}

function getAddressesMap(hre: HardhatRuntimeEnvironment) {
  // Generate a map of name => chain id => address.
  const networksPath = path.join(getCorePath(hre, "./"), "networks");
  const dirs = fs.readdirSync(networksPath);
  const addresses: { [name: string]: { [chainId: number]: string } } = {};
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

    const artifacts = await getArtifactPathList(hre, "./");
    const addresses = getAddressesMap(hre);

    // Write Ethers contract types/factories export.
    fs.appendFileSync(
      out,
      `export type {
  TypedListener as TypedListenerEthers,
  MinEthersFactory as MinEthersFactoryEthers,
  GetContractTypeFromFactory as GetContractTypeFromFactoryEthers,
  GetARGsTypeFromFactory as GetARGsTypeFromFactoryEthers,
  TypedEventFilter as TypedEventFilterEthers,
  TypedEvent as TypedEventEthers,
} from "../typechain/ethers/commons";\n`
    );

    fs.appendFileSync(out, "export type {\n");
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/ethers/${contractName}.d.ts`))
        fs.appendFileSync(out, `  ${contractName} as ${contractName}Ethers,\n`);
    });
    fs.appendFileSync(out, '} from "../typechain/ethers";\n');

    fs.appendFileSync(out, "export {\n");
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/ethers/factories/${contractName}__factory.ts`))
        fs.appendFileSync(out, `  ${contractName}__factory as ${contractName}Ethers__factory,\n`);
    });
    fs.appendFileSync(out, '} from "../typechain/ethers";\n');

    // Write Web3 contract types.
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/web3/${contractName}.d.ts`))
        fs.appendFileSync(
          out,
          `export type { ${normalizeClassName(contractName)} as ${normalizeClassName(
            contractName
          )}Web3 } from "../typechain/web3/${contractName}";\n`
        );
    });

    // Write abi and bytecode for the browser file.
    // Note: the idea behind writing the functions this way is to make them as optimized as possible for tree-shaking
    // to remove any unused json files. In modern versions of webpack, this should allow absolutely _no_ artifact
    // information that isn't needed to be pulled in.
    artifacts.forEach(({ contractName, relativePath }) => {
      const abi = JSON.stringify(JSON.parse(fs.readFileSync(relativePath).toString("utf8")).abi);
      fs.appendFileSync(out, `export function get${contractName}Abi(): any[] { return JSON.parse(\`${abi}\`); }\n`);
    });
    artifacts.forEach(({ contractName, relativePath }) => {
      const bytecode = JSON.stringify(JSON.parse(fs.readFileSync(relativePath).toString("utf8")).bytecode);
      fs.appendFileSync(out, `export function get${contractName}Bytecode(): string { return \`${bytecode}\`; }\n`);
    });

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
    fs.appendFileSync(
      out,
      `export type {
  TypedListener as TypedListenerEthers,
  MinEthersFactory as MinEthersFactoryEthers,
  GetContractTypeFromFactory as GetContractTypeFromFactoryEthers,
  GetARGsTypeFromFactory as GetARGsTypeFromFactoryEthers,
  TypedEventFilter as TypedEventFilterEthers,
  TypedEvent as TypedEventEthers,
} from "../typechain/ethers/commons";\n`
    );

    fs.appendFileSync(out, "export type {\n");
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/ethers/${contractName}.d.ts`))
        fs.appendFileSync(out, `  ${contractName} as ${contractName}Ethers,\n`);
    });
    fs.appendFileSync(out, '} from "../typechain/ethers";\n');

    fs.appendFileSync(out, "export {\n");
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/ethers/factories/${contractName}__factory.ts`))
        fs.appendFileSync(out, `  ${contractName}__factory as ${contractName}Ethers__factory,\n`);
    });
    fs.appendFileSync(out, '} from "../typechain/ethers";\n');

    // Write Web3 contract types.
    artifacts.forEach(({ contractName }) => {
      if (fs.existsSync(`typechain/web3/${contractName}.d.ts`))
        fs.appendFileSync(
          out,
          `export type { ${normalizeClassName(contractName)} as ${normalizeClassName(
            contractName
          )}Web3 } from "../typechain/web3/${contractName}";\n`
        );
    });

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
      `function isDeploymentName(name: string): name is DeploymentName { return addressFunctions.hasOwnProperty(name); }
interface HRE {
  getChainId: () => Promise<string>;
  deployments: {
    get: (name: string) => { address: string };
    getOrNull: (name: string) => ({ address: string } | null)
  }
}
export async function getAddress(name: DeploymentName | ContractName, chainId: number): Promise<string> {
  if (typeof chainId !== "number") throw new Error("chainId must be a number");
  const hre = (global as unknown as { hre?: HRE }).hre;
  const hreDeployment = hre && parseInt(await hre.getChainId()) === chainId && await hre.deployments.getOrNull(name);
  if (hreDeployment) return hreDeployment.address;
  if (!isDeploymentName(name)) throw new Error(\`No deployments for name: \${name}\`);
  const fn = addressFunctions[name];
  return fn(chainId);
}
`
    );
  });

task("load-addresses", "Load addresses from the networks folder into the hardhat deployments folder").setAction(
  async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    // Generate chain id mapping.
    const chainIdToNetworkName: { [chainId: number]: string } = {};
    for (const [name, { chainId }] of Object.entries(hre.config.networks)) {
      if (chainId !== undefined) chainIdToNetworkName[chainId] = name;
    }

    const dirs = fs.readdirSync("./networks");
    for (const dir of dirs) {
      // Infer chainId and network name from the file we're reading.
      const chainId = parseInt(dir.split(".")[0]);
      const networkName = chainIdToNetworkName[chainId];
      if (!networkName) {
        console.error(`Skipping file ./networks/${dir} because there is no configured network for this chainId`);
      }
      // Force hardhat deployment to read the intended network name.
      hre.network.name = networkName;
      const deployments = JSON.parse(fs.readFileSync(`./networks/${dir}`, "utf8"));

      // Loop over the deployments in the file and save each one.
      for (const { contractName, address, deploymentName } of deployments) {
        // If deploymentName isn't specified, use contractName.
        const saveName = deploymentName ? deploymentName : contractName;
        const abi = hre.artifacts.readArtifactSync(contractName).abi;

        // Save the deployment using hardhat deploy's built-in function.
        await hre.deployments.save(saveName, { address, abi });
      }

      // Ensure the chainId file records the correct chainId.
      const chainIdFilePath = `./deployments/${networkName}/.chainId`;
      fs.unlinkSync(chainIdFilePath);
      fs.writeFileSync(chainIdFilePath, chainId.toString());
    }
  }
);
