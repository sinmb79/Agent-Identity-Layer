/**
 * Assigns the next sequential AIL-YYYY-NNNNN registration ID.
 * Wraps the read-increment in an explicit SQLite transaction to prevent gaps or
 * duplicates under concurrent requests.
 */
export function nextAilId(db) {
  const year = new Date().getFullYear();

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO ail_sequence (year, next_seq) VALUES (?, 1)
       ON CONFLICT(year) DO NOTHING`
    ).run(year);

    const row = db.prepare(
      "SELECT next_seq FROM ail_sequence WHERE year = ?"
    ).get(year);

    db.prepare(
      "UPDATE ail_sequence SET next_seq = next_seq + 1 WHERE year = ?"
    ).run(year);

    db.exec("COMMIT");

    const seq = row.next_seq;
    return `AIL-${year}-${String(seq).padStart(5, "0")}`;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
