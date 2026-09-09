import { describe, expect, test } from "bun:test"
import { analyzeSql, isReadonlySqlSetting } from "../src/sql/readonly.js"
import { splitSql } from "../src/sql/split.js"

const cases = {
  readonly: [
    "SELECT 1",
    "select * from t",
    "VALUES (1), (2)",
    "SHOW TABLES",
    "SHOW CREATE TABLE t",
    "SHOW DYNAMIC TABLE REFRESH HISTORY WHERE name='dt' LIMIT 10",
    "DESC EXTENDED t",
    "DESCRIBE TABLE t",
    "DESC HISTORY t",
    "SHOW PROPERTIES IN TABLE t",
    "SELECT a FROM t UNION ALL SELECT a FROM s",
    "SELECT * FROM t VERSION AS OF 3",
    "SELECT rank() OVER (ORDER BY a) AS r FROM t QUALIFY r = 1",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "WITH x AS (SELECT 1), y AS (SELECT * FROM x) SELECT * FROM y",
    "EXPLAIN SELECT 1",
    "EXPLAIN EXTENDED WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT CASE WHEN a = 1 THEN 'delete' ELSE 'update' END FROM t",
    "SELECT 'DROP TABLE t; DELETE FROM t', `update`, \"create\" FROM t",
    "SELECT 'it''s a delete', 'escaped\\\' quote; DROP TABLE t'",
    "SELECT replace(a, 'b', 'c'), truncate(1.7) FROM t",
    "SELECT deleted_at, drop_count FROM t",
    "/* outer /* inner */ ; DROP TABLE t */ SELECT 1; -- DELETE FROM t",
    "SELECT /*+ MAPJOIN(t2) */ * FROM t1 JOIN t2 ON t1.id=t2.id",
    "SELECT 1; SELECT 2",
    "SELECT 1 -- comment\r; SELECT 2",
    "SELECT public.external_func(a) FROM t", // String classification makes no purity claim.
  ],
  write: [
    "INSERT INTO t VALUES (1)",
    "INSERT OVERWRITE t SELECT * FROM s",
    "UPDATE t SET a=1 WHERE id=1",
    "DELETE FROM t WHERE id=1",
    "/* note */ DELETE FROM t WHERE id=1",
    "DROP/**/TABLE t",
    "UNDROP TABLE t",
    "MERGE INTO t USING s ON t.id=s.id WHEN MATCHED THEN DELETE",
    "CREATE TABLE t AS SELECT 1",
    "CREATE OR REPLACE VIEW v AS SELECT 1",
    "ALTER TABLE t SET PROPERTIES ('a'='b')",
    "TRUNCATE TABLE t",
    "RENAME TABLE a TO b",
    "GRANT SELECT ON TABLE t TO ROLE r",
    "REVOKE SELECT ON TABLE t FROM ROLE r",
    "COPY INTO t FROM '@v/a.csv'",
    "COPY INTO VOLUME v FROM (SELECT * FROM t)",
    "PUT 'file' INTO VOLUME v",
    "REMOVE '@v/a'",
    "CANCEL JOB 'id'",
    "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
    "WITH x AS (DELETE FROM t) SELECT * FROM x",
    "SELECT 1; DROP TABLE t",
    "SHOW CREATE TABLE t; DROP TABLE t",
    "SHOW DYNAMIC TABLE REFRESH HISTORY; DELETE FROM t",
    "SELECT drop FROM t",
    "SELECT * FROM delete",
    "EXPLAIN DELETE FROM t",
  ],
  session: [
    "SET cz.sql.timezone=UTC",
    "SET query_tag='drop; delete'",
    "SET query_timeout=300",
    "USE SCHEMA public",
    "USE WORKSPACE ws",
    "USE VCLUSTER vc",
    "USE `my-schema`",
    "USE SCHEMA public; SET cz.sql.timezone=UTC; SELECT 1",
  ],
  unknown: [
    "",
    "-- only comment",
    "/* only comment */",
    "SELECT 'unterminated",
    "SELECT `unterminated",
    "SELECT 1 /* missing end",
    "SELECT (1",
    "SELECT 1)",
    "SELECT (1; 2)",
    "SELECT $$unknown$$",
    "SELECT $tag$unknown$tag$",
    "SELECT 1 # unsupported comment",
    "SELECT 1 */",
    "'prefix' SELECT 1",
    "BEGIN SELECT 1; SELECT 2; END",
    "CALL proc()",
    "EXECUTE 'SELECT 1'",
    "SELECT 1 INTO OUTFILE 'a'",
    "BOGUS 1",
    "WITH x AS (VALUES (1))",
    "EXPLAIN ANALYZE SELECT 1",
    "SET cz.sql.string.literal.escape.mode=quote",
    "SET cz.sql.double.quoted.identifiers=true",
    "SET cz.sql.remote.udf.lookup.policy=udf_first",
    "SET cz.sql.translation.mode=mysql",
    "SET arbitrary=1",
    "SET query_tag=(SELECT 1)",
    "USE SCHEMA t SELECT 1",
    "SELECT /*+ SET_VAR(foo=1) */ 1",
    "SELECT /*+ MAPJOIN(t) SET_VAR(foo=1) */ 1",
  ],
} as const

for (const [kind, queries] of Object.entries(cases)) {
  describe(kind, () => {
    for (const sql of queries) test(sql || "empty input", () => expect(analyzeSql(sql).kind).toBe(kind))
  })
}

test("masking preserves offsets, source text and quoted placeholders", () => {
  const sql = "/*前言*/ SELECT '😀; DROP', `delete`; SELECT 2"
  const result = analyzeSql(sql)
  expect(result.kind).toBe("readonly")
  expect(result.statements).toHaveLength(2)
  for (const item of result.statements) {
    expect(item.sql).toBe(sql.slice(item.start, item.end))
    expect(item.text.length).toBe(item.sql.length)
    expect(item.text).not.toContain("DROP")
    expect(item.text).not.toContain("delete")
  }
  expect(result.statements[0].text).toContain("?")
  expect(splitSql(sql)).toEqual(result.statements.map((item) => item.sql))
})

test("all syntax keywords stay visible through nested and adjacent comments", () => {
  for (const gap of [" ", "\n", "/**/", "/* a /* b */ c */", "-- c\r\n", "-- c\n"]) {
    expect(analyzeSql(`DROP${gap}TABLE t`).kind).toBe("write")
    expect(analyzeSql(`SELECT${gap}'DROP TABLE t'`).kind).toBe("readonly")
  }
})

test("backslash parity and doubled quotes agree with statement splitting", () => {
  for (const quote of ["'", '"', "`"]) {
    for (const count of [0, 2, 4, 6]) {
      const sql = `SELECT ${quote}a${"\\".repeat(count)}${quote}; DELETE FROM t WHERE id=1`
      expect(splitSql(sql)).toHaveLength(2)
      expect(analyzeSql(sql).kind).toBe("write")
    }
    const sql = `SELECT ${quote}a${quote}${quote}; DROP TABLE t${quote}; SELECT 2`
    expect(splitSql(sql)).toHaveLength(2)
    expect(analyzeSql(sql).kind).toBe("readonly")
  }
})

test("malformed trailing input prevents a readonly aggregate", () => {
  expect(analyzeSql("SELECT 1; /* unfinished")).toMatchObject({ kind: "unknown", reason: "Unterminated block comment" })
})

test("long comments and quoted values do not expose keywords", () => {
  expect(analyzeSql(`/*${"/*".repeat(2000)}DROP${"*/".repeat(2000)}*/ SELECT '${"DELETE;".repeat(20000)}'`).kind).toBe(
    "readonly",
  )
})

test("only reviewed settings are accepted", () => {
  expect(isReadonlySqlSetting("CZ.SQL.TIMEZONE")).toBe(true)
  for (const key of [
    "cz.sql.translation.mode",
    "cz.sql.string.literal.escape.mode",
    "cz.sql.remote.udf.lookup.policy",
    "unknown",
  ]) {
    expect(isReadonlySqlSetting(key)).toBe(false)
  }
})
