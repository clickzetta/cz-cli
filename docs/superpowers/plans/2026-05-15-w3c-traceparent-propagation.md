# W3C Traceparent Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate W3C `traceparent` across ClickZetta LLM requests, ClickZetta SDK HTTP requests, and parent-to-child agent runtime handoff.

**Architecture:** Add a small shared trace-context utility that can parse, validate, derive, and serialize `traceparent` values without depending on a fully-enabled OTEL runtime. Reuse it from `opencode` provider fetch wrapping, `@clickzetta/sdk` request builders, and `cz-cli` child-process delegation so all internal services receive consistent headers and parent/child relationships.

**Tech Stack:** TypeScript, Bun tests, existing `@opentelemetry/api` runtime context where available, workspace packages `packages/opencode`, `packages/clickzetta-sdk`, `packages/cz-cli`.

---
