import { createNewLogger } from "./src";
const transportsConfig = {
  // pagerDutyV2Config: { disabled: false },
  pagerDutyV2Config: {
    integrationKey: "5d8b2df0524c4109d0a8e872b3f7c134",
    customServices: {
      bot1: "5d8b2df0524c4109d0a8e872b3f7c134",
      bot2: "86865e7d06b4430ed02a153dec470c4e",
      bot3: "437a8ee7403b4901c0aeae1d5d2c3ebc",
    },
  },
};
async function run(): Promise<void> {
  console.log("running");
  await new Promise((res) => setTimeout(res, 1000));
  const logger = createNewLogger([], transportsConfig, "test-bot");
  logger.error({ notificationPath: "bot1", at: "tester", message: "markdown", mrkdwn: "*headding*\nsome test" });
  // logger.error({ notificationPath: "bot2", at: "tester", message: "bot2 error", someComplexType: { a: "b" } });
  // logger.error({ notificationPath: "bot3", at: "tester", message: "bot3 error", someComplexType: { a: "b" } });
}
run()
  .then(async () => {
    console.log("done");
  })
  .catch(async (error) => {
    console.error("Process exited with", error);
  });
