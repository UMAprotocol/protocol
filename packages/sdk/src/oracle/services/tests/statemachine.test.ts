import assert from "assert";
import { Context, StateMachine } from "../statemachine";

const handler1 = {
  start() {
    return "two";
  },
  two() {
    return "three";
  },
  three() {
    return "done";
  },
};
const handler2 = {
  start() {
    throw new Error("fail");
  },
};
type Counter = { count?: number };
const handler3 = {
  start(endCount: number, memory: Counter) {
    if (memory.count == undefined) memory.count = 0;
    memory.count++;
    if (memory.count >= endCount) return "done";
    return undefined;
  },
};
describe("Oracle Statemachine", () => {
  describe("handler1", () => {
    let sm: StateMachine;
    const state: Record<string, Context> = {};
    beforeAll(() => {
      sm = new StateMachine("handler1", handler1, (context: Context) => {
        state[context.id] = context;
      });
    });
    test("create", () => {
      sm.create(undefined, undefined, { id: "a" }, 1);
      assert.ok(state.a);
    });
    test("tick", async () => {
      await sm.tick();
      assert.ok(state.a);
      assert.equal(state.a.state, "two");
      assert.equal(state.a.done, false);
    });
    test("tick", async () => {
      await sm.tick();
      assert.equal(state.a.state, "three");
      assert.equal(state.a.done, false);
    });
    test("tick", async () => {
      await sm.tick();
      assert.equal(state.a.state, "done");
      assert.equal(state.a.done, true);
    });
  });
  describe("handler2", () => {
    let sm: StateMachine;
    const state: Record<string, Context> = {};
    beforeAll(() => {
      sm = new StateMachine("handler2", handler2, (context: Context) => {
        state[context.id] = context;
      });
    });
    test("create", () => {
      sm.create(undefined, undefined, { id: "b" }, 1);
      assert.ok(state.b);
    });
    test("tick", async () => {
      await sm.tick();
      assert.ok(state.b);
      assert.equal(state.b.done, true);
      assert.equal(state.b.state, "error");
      assert.ok(state.b.error, "error");
    });
  });
  describe("handler3", () => {
    let sm: StateMachine<number, Counter>;
    const state: Record<string, Context<number, Counter>> = {};
    let id: string;
    beforeAll(() => {
      sm = new StateMachine<number, Counter>("handler3", handler3, (context: Context<number, Counter>) => {
        state[context.id] = context;
      });
    });
    test("create", () => {
      id = sm.create(3, {}, { interval: 10 }, 0);
      assert.equal(Object.values(state).length, 1);
    });
    test("tick", async () => {
      // first tick at time 0, initialize memory and increment 1
      await sm.tick(0);
      let ctx = state[id];
      assert.ok(ctx);
      assert.equal(ctx.done, false);
      assert.equal(ctx.memory?.count, 1);
      assert.equal(ctx.updated, 0);

      // second tick at 5, is before the interval of 10, should not count
      await sm.tick(5);
      ctx = state[id];
      assert.ok(ctx);
      assert.equal(ctx.done, false);
      assert.equal(ctx.memory?.count, 1);
      assert.equal(ctx.updated, 0);

      // third tick at 10 is on the interval, tick and increment
      await sm.tick(10);
      ctx = state[id];
      assert.equal(ctx.done, false);
      assert.equal(ctx.memory?.count, 2);
      assert.equal(ctx.updated, 10);

      // fourth tick before interval of 10, no increment
      await sm.tick(15);
      ctx = state[id];
      assert.equal(ctx.memory?.count, 2);
      assert.equal(ctx.updated, 10);

      // last tick increments value to 3, which triggers end state, find in done table.
      await sm.tick(20);
      ctx = state[id];
      assert.ok(ctx);
      assert.equal(ctx.memory?.count, 3);
      assert.equal(ctx.done, true);
      assert.equal(ctx.updated, 20);
    });
  });
});
