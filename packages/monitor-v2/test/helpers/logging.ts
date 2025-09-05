import sinon from "sinon";
import { createNewLogger, SpyTransport } from "@uma/financial-templates-lib";

export const makeSpyLogger = () => {
  const spy = sinon.spy();
  const logger = createNewLogger([new SpyTransport({}, { spy })]);
  return { spy, logger };
};

export const findLogIndex = (spy: sinon.SinonSpy, at: string, message: string) =>
  spy.getCalls().findIndex((c) => c.lastArg?.message === message && c.lastArg?.at === at);
