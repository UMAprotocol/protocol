import { buildServer } from "./server.js";

async function main() {
  const { start } = await buildServer();
  await start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

export {};
