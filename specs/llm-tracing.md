# Complete LLM traces

The `experimental.chat.llm` observer captures individual provider invocations. It is
separate from replayable session message events: a request can fail or be canceled
before the session processor receives its first step event. Each invocation has a
new request ID, including retries, and owns one `chat {model}` span. Request capture
is scoped to the invocation so concurrent sessions do not share content.

The AI SDK observer runs after provider message transformations. Its fetch context
captures the serialized body before HTTP dispatch. The native adapter observes its
transport requests, including individual HTTP retry attempts. Provider implementations
that bypass the shared fetch wrapper can supply the SDK's returned request body;
this fallback is only available after response headers arrive. Custom fetch adapters
that rewrite the endpoint or body after this boundary must call
`ProviderRequest.record` at their final dispatch boundary to expose those changes.
Authentication refresh calls are outside the model invocation payload.

| Attribute | Content |
| --- | --- |
| `gen_ai.input.messages` | Complete final model messages, excluding system instructions |
| `gen_ai.system_instructions` | Final system instructions |
| `gen_ai.tool.definitions` | Complete tool definitions and schemas |
| `clickzetta.llm.request` | Final SDK/native request, including provider options |
| `clickzetta.llm.request.body` | Serialized provider body decoded as JSON when possible |
| `clickzetta.llm.response.events` | All observed response events, including partial output |
| `gen_ai.output.messages` | Accumulated text, reasoning, and tool calls |
| `opencode.llm.outcome` | `completed`, `error`, or `canceled` |

Content attributes are redacted using the existing credential rules and are omitted
when content recording is disabled. Authentication headers are never captured.
Tool schema property names are preserved. No message, part, argument, or output is
removed to satisfy a client-side length budget. SDK attribute-length truncation is
explicitly disabled for this exporter.

To repeat a captured HTTP call, use its request body, endpoint, method, and current
provider credentials. Redacted values require replacement. The normalized request
is useful for changing models or parameters, but the provider body is the reference
for what was sent. Historical tool results are already in the request; repeating a
model call does not execute newly generated tool calls.

Canceled and failed calls retain their full request and all response events observed
before termination. A stream ending without a finish event is an error. Shutdown
closes outstanding calls as canceled. Abrupt process termination cannot guarantee
export of unfinished spans; there is no local persistence or recovery mechanism.

Collectors, proxies, and storage must accept the resulting payload sizes without
truncation. The regression suite verifies complete export to a local OTLP endpoint;
production collector and backend limits require deployment-level verification.
