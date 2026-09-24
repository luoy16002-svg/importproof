import test from "node:test";
import assert from "node:assert/strict";
import { loadDemo } from "../src/demo";
import { profile } from "../src/engine";
import { prepareRequest, propose } from "../server/model";
const { data, plan } = loadDemo();
const config = {
  key: "test-key-never-a-real-credential",
  model: "nvidia/test-fixture",
};
test("server strips sample values when consent is false, even if a client sends them", () => {
  const clean = prepareRequest({
    profile: profile(data, true),
    shareSamples: false,
  });
  assert.equal(JSON.stringify(clean).includes("Arc table lamp"), false);
});
test("only allowed endpoint is called and returned plan is validated before exposure", async () => {
  const fake = (async (url, options) => {
    assert.equal(
      url,
      "https://api.tokenfactory.nebius.com/v1/chat/completions",
    );
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, config.model);
    assert.equal(body.response_format.type, "json_object");
    assert.equal(JSON.stringify(body).includes("Arc table lamp"), false);
    return new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify(plan) }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      }),
    );
  }) as typeof fetch;
  const result = await propose(
    { profile: profile(data), shareSamples: false },
    config,
    fake,
  );
  assert.deepEqual(result.plan, plan);
  assert.equal(result.sampleCount, 0);
  assert.equal(result.usage.inputTokens, 200);
  assert.equal(JSON.stringify(result).includes(config.key), false);
});
for (const [label, response] of [
  [
    "unknown column",
    {
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...plan,
              mappings: plan.mappings.map((m, i) =>
                i === 0 ? { ...m, source: "hallucinated" } : m,
              ),
            }),
          },
        },
      ],
    },
  ],
  [
    "truncation",
    {
      choices: [
        { finish_reason: "length", message: { content: JSON.stringify(plan) } },
      ],
    },
  ],
  ["refusal", { choices: [{ message: { refusal: "refused" } }] }],
  ["malformed JSON", { choices: [{ message: { content: "{ broken" } }] }],
  [
    "extra executable instructions",
    {
      choices: [
        {
          message: {
            content: JSON.stringify({ ...plan, execute: "do anything" }),
          },
        },
      ],
    },
  ],
] as const)
  test(`model ${label} cannot apply a recipe`, async () => {
    const fake = (async () =>
      new Response(JSON.stringify(response))) as typeof fetch;
    await assert.rejects(
      propose({ profile: profile(data), shareSamples: false }, config, fake),
    );
  });
test("provider failure does not leak private response text", async () => {
  const fake = (async () =>
    new Response("secret provider detail", { status: 402 })) as typeof fetch;
  await assert.rejects(
    propose({ profile: profile(data), shareSamples: false }, config, fake),
    (e) =>
      e instanceof Error &&
      e.message.includes("402") &&
      !e.message.includes("secret"),
  );
});
test("missing credentials cannot trigger any call", async () => {
  let calls = 0;
  const fake = (async () => {
    calls++;
    return new Response();
  }) as typeof fetch;
  await assert.rejects(
    propose(
      { profile: profile(data), shareSamples: false },
      { key: "", model: "" },
      fake,
    ),
  );
  assert.equal(calls, 0);
});
