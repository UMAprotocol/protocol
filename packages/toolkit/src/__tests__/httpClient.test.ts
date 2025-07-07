import { AxiosInstance } from "axios";
import MockAdapter from "axios-mock-adapter";
import { createHttpClient } from "../index";

describe("createHttpClient", () => {
  let client: AxiosInstance;
  let mock: MockAdapter;

  beforeEach(() => {
    // Use default settings
    client = createHttpClient();
    mock = new MockAdapter(client);
  });

  afterEach(() => {
    mock.restore();
  });

  it("should perform a simple GET request", async () => {
    mock.onGet("/foo").reply(200, { hello: "world" });

    const response = await client.get("/foo");
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ hello: "world" });
  });

  it("should apply custom axios config (baseURL)", () => {
    const baseURL = "https://api.example.com";
    const custom = createHttpClient({ axios: { baseURL } });
    expect(custom.defaults.baseURL).toBe(baseURL);
  });

  it("should retry failed requests with default retry options", async () => {
    // First two attempts fail with 500, third succeeds
    mock.onGet("/retry").replyOnce(500).onGet("/retry").replyOnce(500).onGet("/retry").reply(200, { ok: true });

    const response = await client.get("/retry");
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
  });

  it("should respect custom retry count", async () => {
    mock.restore();
    const customClient = createHttpClient({ retry: { retries: 1 } });
    mock = new MockAdapter(customClient);

    mock.onGet("/once").replyOnce(500).onGet("/once").reply(200, { done: true });

    const resp = await customClient.get("/once");
    expect(resp.data).toEqual({ done: true });
  });

  it("should retry on 429 Too Many Requests", async () => {
    mock.onGet("/rate-limit").replyOnce(429).onGet("/rate-limit").reply(200, { success: true });

    const resp = await client.get("/rate-limit");
    expect(resp.data).toEqual({ success: true });
  });

  it("should throw an error after exceeding retry attempts", async () => {
    mock.onGet("/fail").reply(500);

    await expect(client.get("/fail")).rejects.toThrow();
  });

  it("should throw an error containing custom response body", async () => {
    const errorBody = { message: "Custom failure" };
    mock.onGet("/custom-error").reply(400, errorBody);

    await expect(client.get("/custom-error")).rejects.toMatchObject({
      response: { status: 400, data: errorBody },
    });
  });
});
