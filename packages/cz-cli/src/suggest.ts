// "Did you mean" suggestions for mistyped commands, subcommands, and flags.
//
// Mirrors Azure CLI's CommandRecommender behavior (difflib.get_close_matches,
// cutoff=0.7): when a token is not recognized, propose the closest known
// candidate so humans and agents can self-correct. Unlike yargs' built-in
// recommendCommands (fixed edit-distance threshold of 3, text-only output),
// this uses a length-normalized threshold — so short tokens like "sql" don't
// get falsely matched to "job" — and returns the candidate as data so callers
// can put it in a structured `did_you_mean` field.

/**
 * Damerau-Levenshtein edit distance (insert / delete / substitute / adjacent
 * transposition). Transposition counts as 1, so "tabel" -> "table" is distance 1.
 * Same algorithm as yargs' internal levenshtein.
 */
export function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0]![j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!
      } else if (
        i > 1 &&
        j > 1 &&
        b.charAt(i - 2) === a.charAt(j - 1) &&
        b.charAt(i - 1) === a.charAt(j - 2)
      ) {
        // adjacent transposition
        matrix[i]![j] = matrix[i - 2]![j - 2]! + 1
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitute
          matrix[i]![j - 1]! + 1, // insert
          matrix[i - 1]![j]! + 1, // delete
        )
      }
    }
  }
  return matrix[b.length]![a.length]!
}

/**
 * Max edit distance tolerated for a token of the given length. Scales with
 * length so a 1-char typo in a short command still matches, but unrelated
 * short words don't ("sql" vs "job" is distance 3, rejected at maxDistance 1).
 */
function maxDistanceFor(length: number): number {
  if (length <= 4) return 1
  if (length <= 7) return 2
  return 3
}

/**
 * Return the closest candidate to `input`, or undefined if none is close
 * enough. Comparison is case-insensitive; the candidate is returned with its
 * original casing. Ties break toward the longer candidate (matches yargs).
 */
export function suggestClosest(
  input: string,
  candidates: readonly string[],
): string | undefined {
  if (!input) return undefined
  const needle = input.toLowerCase()
  const maxDistance = maxDistanceFor(needle.length)

  // Longer candidates first so equal distances prefer the longer match.
  const ordered = [...candidates].sort((a, b) => b.length - a.length)

  let best: string | undefined
  let bestDistance = Infinity
  for (const candidate of ordered) {
    const d = editDistance(needle, candidate.toLowerCase())
    if (d <= maxDistance && d < bestDistance) {
      bestDistance = d
      best = candidate
      if (d === 0) break
    }
  }
  return best
}
