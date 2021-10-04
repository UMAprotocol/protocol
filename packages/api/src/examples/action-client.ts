import fetch from "isomorphic-fetch";
import type { Json } from "../types";
import assert from "assert";
import join from "url-join";

// TODO: this should be moved into a frontend library repo when available
// This is a basic client to allow you to call into the server in the form of
// client(action,arg1,arg2,...etc) => Promise<Json>.
// see tests for usage.
export default function Client(host: string, channel = "") {
  assert(host, "requires api host url");

  const defaultOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    mode: "cors",
    body: [],
  };

  async function call(action: string, ...args: Json[]): Promise<Json> {
    const url = join(host, channel, action);
    const options = {
      ...defaultOptions,
      body: JSON.stringify(args),
    };
    // fetch has a really bad api
    const res = await fetch(url, options);
    const text = await res.text();
    assert(res.ok, text);
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }

  return call;
}
export type Client = ReturnType<typeof Client>;
