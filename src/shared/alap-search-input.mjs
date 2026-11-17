// Copyright 2026 Daniel Smith
// SPDX-License-Identifier: Apache-2.0
// Dispatch only. No parsing, matching or browser state. Literal quoted-search
// escape rules remain a separate step-5 compatibility decision.
import { ALAP_LIMITS } from "./alap-data.mjs";
export function classifySearchInput(value) {
  if (typeof value !== "string" || value.length > ALAP_LIMITS.expressionCharacters)
    throw new Error("Search needs text of at most 4,096 characters.");
  const text = value.trim();
  // Mr. Smith and name@example.com remain ordinary text. A leading sigil or
  // sigil after an expression boundary selects strict Alap, including bare ./@.
  return { kind: /(?:^|[\s(+|,\-])[.@]/.test(text) ? "alap" : "text", text };
}
export const usesAlapSyntax = (value) => classifySearchInput(value).kind === "alap";
