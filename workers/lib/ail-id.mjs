/**
 * Assigns the next sequential AIL-YYYY-NNNNN registration ID.
 * Uses D1 batch() for atomic read-increment.
 */
export async function nextAilId(db) {
  const year = new Date().getFullYear();

  // D1 batch executes atomically
  const results = await db.batch([
    db.prepare(
      "INSERT INTO ail_sequence (year, next_seq) VALUES (?, 1) ON CONFLICT(year) DO NOTHING"
    ).bind(year),
    db.prepare("SELECT next_seq FROM ail_sequence WHERE year = ?").bind(year),
    db.prepare("UPDATE ail_sequence SET next_seq = next_seq + 1 WHERE year = ?").bind(year),
  ]);

  const seq = results[1].results[0].next_seq;
  return `AIL-${year}-${String(seq).padStart(5, "0")}`;
}
