import { buildServer } from "./server.js";

async function main() {
  const { start } = await buildServer();
  await start();
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

export {};
