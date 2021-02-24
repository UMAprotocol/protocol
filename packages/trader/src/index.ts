import { config } from "dotenv";
config();
import retry from "async-retry";
import { TraderConfig } from "./TraderConfig";

export async function run(): Promise<void> {
  // Config Processing
  // const config = new TraderConfig(process.env);
  await retry(
    async () => {
      // Trading logic here.
    },
    {
      retries: 3,
      minTimeout: 5 * 1000, // delay between retries in ms
      randomize: false,
      onRetry: (error: Error, attempt: number) => {
        console.log(error, attempt);
      }
    }
  );
}

if (require.main === module) {
  run()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
