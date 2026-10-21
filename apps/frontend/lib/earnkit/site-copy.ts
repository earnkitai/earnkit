/**
 * v3.1 site copy and pure formatters. Site Task 1 adds scoreBand (ScoreText needs it); site Task 2
 * adds the rest of this file.
 */

/** The score's band: good 70 and up, mid 40 to 69, low under 40. */
export function scoreBand(score: number): 'good' | 'mid' | 'low' {
  return score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low';
}
