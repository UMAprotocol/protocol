import fs from "fs";
import path from "path";
import { runTypeChain } from "typechain";
import { getSafeL2SingletonDeployment, getMultiSendCallOnlyDeployment } from "@safe-global/safe-deployments";

const version = "1.3.0";

async function main() {
  const safeL2SingletonDeployment130 = getSafeL2SingletonDeployment({ version });
  if (!safeL2SingletonDeployment130) throw new Error(`SafeL2SingletonDeployment v${version} not found!`);
  const multiSendCallOnlyDeployment130 = getMultiSendCallOnlyDeployment({ version });
  if (!multiSendCallOnlyDeployment130) throw new Error(`MultiSendCallOnlyDeployment v${version} not found!`);
  const deployments = [safeL2SingletonDeployment130, multiSendCallOnlyDeployment130];

  const abiDir = path.resolve(__dirname, "./build/abi");
  const typechainDir = path.resolve(__dirname, "./build/typechain");
  fs.mkdirSync(abiDir, { recursive: true });
  fs.mkdirSync(typechainDir, { recursive: true });

  const abiPaths = deployments.map((deployment) => {
    const abiPath = path.join(abiDir, `${deployment.contractName}${version.replace(/\./g, "")}.json`);
    fs.writeFileSync(abiPath, JSON.stringify(deployment.abi, null, 2));
    return abiPath;
  });

  const { filesGenerated } = await runTypeChain({
    cwd: __dirname,
    filesToProcess: abiPaths,
    allFiles: abiPaths,
    outDir: typechainDir,
    target: "ethers-v5",
  });
  console.log(`Generated ethers-v5 typechain for ${filesGenerated} files`);
}

main().catch((err) => {
  console.error("Failed to generate types:", err);
  process.exit(1);
});
