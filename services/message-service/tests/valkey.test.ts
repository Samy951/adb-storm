import { describe, it, expect } from "bun:test";
import { parseStreamFields } from "../src/valkey";

describe("parseStreamFields", () => {
  it("parses valid fields", () => {
    const result = parseStreamFields([
      "user_id", "u1", "channel_id", "c1", "content", "hello",
    ]);
    expect(result).toEqual({ user_id: "u1", channel_id: "c1", content: "hello" });
  });

  it("returns null for missing user_id", () => {
    const result = parseStreamFields(["channel_id", "c1", "content", "hello"]);
    expect(result).toBeNull();
  });

  it("returns null for missing channel_id", () => {
    const result = parseStreamFields(["user_id", "u1", "content", "hello"]);
    expect(result).toBeNull();
  });

  it("returns null for missing content", () => {
    const result = parseStreamFields(["user_id", "u1", "channel_id", "c1"]);
    expect(result).toBeNull();
  });

  it("returns null for empty content", () => {
    const result = parseStreamFields([
      "user_id", "u1", "channel_id", "c1", "content", "",
    ]);
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    const result = parseStreamFields([
      "user_id", "u1", "channel_id", "c1", "content", "   ",
    ]);
    expect(result).toBeNull();
  });

  it("returns null for empty fields array", () => {
    const result = parseStreamFields([]);
    expect(result).toBeNull();
  });

  it("handles extra fields gracefully", () => {
    const result = parseStreamFields([
      "user_id", "u1", "channel_id", "c1", "content", "hello", "extra", "ignored",
    ]);
    expect(result).toEqual({ user_id: "u1", channel_id: "c1", content: "hello" });
  });
});
