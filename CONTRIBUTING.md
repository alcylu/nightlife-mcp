# Contributing to nightlife-mcp

MCP server exposing read access to the Nightlife Tokyo database for AI agents (Claude desktop, etc.). Stack: Node + TypeScript.

## Workflow

- Branch from `main`, or push to `main` directly for hotfixes
- No CI on PRs today (see "What to add" below) — run `npm test` locally before pushing
- Deploys via Docker (manual or Railway, see CLAUDE.md)

## Rules for new code

1. **Every bug fix ships with a regression test** added to `npm test` (currently `tsx --test src/**/*.test.ts`).
2. **Every new tool exposed through MCP gets a test** covering at least the happy-path response shape and the unauthorized case.
3. **If a test isn't possible** (e.g. real Supabase round-trip with prod data), say so explicitly in the PR description and verify manually.

## Pre-push hook

`.githooks/pre-push` runs `npm test` locally before each push. Activated on `npm install` via the `prepare` script. Bypass with `git push --no-verify` if needed.

## What to add

This repo would benefit from a GitHub Actions workflow (`.github/workflows/test.yml`) running `npm test` on every push and PR — same shape as the `nightlife` repo. Not added today because there's no test fixture pattern yet for the MCP tools that hit Supabase.

## Questions

Architecture: `CLAUDE.md`. AI agent context: `AGENTS.md`.
