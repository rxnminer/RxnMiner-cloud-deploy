import assert from "node:assert/strict";
import { test } from "node:test";
import { isPiThinkingDelta } from "../src/local-agent.js";

test("only incremental reasoning is omitted from the durable event stream", () => {
  assert.equal(isPiThinkingDelta({
    type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "token" },
  }), true);
  for (const type of ["text_delta", "toolcall_delta", "thinking_end", "text_end"]) {
    assert.equal(isPiThinkingDelta({ type: "message_update", assistantMessageEvent: { type } }), false);
  }
  assert.equal(isPiThinkingDelta({ type: "message_end", message: { role: "assistant", usage: { output: 200 } } }), false);
  assert.equal(isPiThinkingDelta(null), false);
});
