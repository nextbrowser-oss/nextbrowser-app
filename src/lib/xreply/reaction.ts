// Reaction GIFs, ported from the Go service's internal/reply/reaction.go.
//
// A closed set is the point: the account attaches whatever the X GIF picker
// returns first, so a free-text search phrase makes the set of GIFs the account
// can ever post unbounded and unreviewable. With a fixed vocabulary the whole
// reachable set is a handful of curated searches an operator can audit, and the
// model only has to recognize a mood instead of inventing a search phrase.

/// The answer an older prompt accepted instead of a mood. Nothing asks for it
/// now — every reply carries a GIF — but a model that answers it anyway must
/// still resolve to something, so it falls back to a mood picked from the post.
export const REACTION_NONE = "none";

/** Several phrases per reaction keep the account from attaching the same GIF
 *  every time, and every phrase is deliberately specific: a broad one such as
 *  "funny" returns whatever the picker promotes that day. */
const REACTION_QUERIES: Record<string, string[]> = {
  agree: ["nodding in agreement", "exactly this nodding", "agreed handshake"],
  celebrate: ["cheers celebration", "confetti celebration", "high five celebration"],
  shipping: ["rocket launch liftoff", "typing fast keyboard", "green light go"],
  mind_blown: ["mind blown", "jaw drop surprised", "eyes wide shocked"],
  laughing: ["laughing out loud", "cracking up laughing", "cannot stop laughing"],
  skeptical: ["raised eyebrow skeptical", "side eye suspicious", "squinting doubtful"],
  waiting: ["still waiting patiently", "tapping fingers waiting", "watching the clock"],
};

/** The obvious off-brand results, kept out of a public reply. Deliberately
 *  short and about content rather than opinions; anything else an account will
 *  not say in its name goes into the user's own blocklist. */
export const DEFAULT_GIF_BLOCKLIST = [
  "nsfw", "sexy", "sexual", "nude", "naked", "twerk", "lingerie", "porn",
  "blood", "gore", "gun", "shooting", "corpse", "nazi", "hitler",
  "cocaine", "heroin", "overdose", "suicide",
];

/** reactions lists every accepted reaction, none first, so the prompt and the
 *  parser always advertise the same vocabulary. */
export function reactions(): string[] {
  return [REACTION_NONE, ...Object.keys(REACTION_QUERIES).sort()];
}

export function validReaction(value: string): boolean {
  return value === REACTION_NONE || value in REACTION_QUERIES;
}

/** normalizeReaction maps a model's answer onto the vocabulary. Anything else
 *  becomes none: an unknown reaction must never reach the GIF picker. */
export function normalizeReaction(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return validReaction(normalized) ? normalized : REACTION_NONE;
}

/** moods lists the reactions that resolve to a GIF, none excluded. */
export function moods(): string[] {
  return Object.keys(REACTION_QUERIES).sort();
}

/** resolveReaction is what the account actually reacts with. Every reply
 *  carries a GIF, so a model that named no mood — or named one the vocabulary
 *  does not have — still gets one, chosen from the post rather than at random:
 *  the same post keeps the same reaction across retries, and different posts
 *  spread across the vocabulary instead of all landing on one mood. */
export function resolveReaction(value: string | undefined, seed: string): string {
  const named = normalizeReaction(value);
  if (named !== REACTION_NONE) return named;
  const list = moods();
  return list[fnv1a(`mood:${seed}`) % list.length];
}

/** fnv1a matches Go's hash/fnv 32-bit variant, so the same post resolves to the
 *  same search phrase in both implementations. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** reactionQuery picks the search phrase for a reaction. The choice is derived
 *  from the seed, so the same post always resolves to the same search while
 *  different posts rotate through the phrases. */
export function reactionQuery(reaction: string, seed: string): string {
  const queries = REACTION_QUERIES[reaction];
  if (!queries?.length) return "";
  return queries[fnv1a(seed) % queries.length];
}
