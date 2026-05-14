/**
 * UWFlow prereq text → boolean AST. The grammar is reverse-engineered from
 * the prose; anything that doesn't match becomes a RAW node so satisfied.ts
 * can surface it as "uncertain" rather than failing the user.
 *
 * Grammar (precedence, lowest → highest):
 *   expression := and_clause (";" and_clause)*
 *   and_clause := or_clause ("and" or_clause)*
 *   or_clause  := primary ("or" primary)*
 *   primary    := COURSE
 *              |  "one of" COURSE ("," COURSE)*       (OR over the list)
 *              |  "(" expression ")"
 *              |  RAW_TEXT                            (level/program/etc.)
 */

export type PrereqNode =
  | { kind: "course"; code: string }
  | { kind: "and"; children: PrereqNode[] }
  | { kind: "or"; children: PrereqNode[] }
  | { kind: "level"; minLevel: string }
  | { kind: "raw"; text: string };

type Token =
  | { kind: "COURSE"; code: string }
  | { kind: "OR" }
  | { kind: "AND" }
  | { kind: "ONE_OF" }
  | { kind: "LPAREN" }
  | { kind: "RPAREN" }
  | { kind: "COMMA" }
  | { kind: "SEMI" }
  | { kind: "LEVEL"; minLevel: string }
  | { kind: "RAW"; text: string }
  | { kind: "END" };

const COURSE_RE = /^([A-Z]{2,7})\s?(\d{3}[A-Z]?)/;
const LEVEL_RE = /^level at least (\d[a-z])/i;
const ONE_OF_RE = /^one of\b/i;
const OR_RE = /^or\b/i;
const AND_RE = /^and\b/i;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;

  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "LPAREN" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "RPAREN" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "COMMA" });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ kind: "SEMI" });
      i++;
      continue;
    }
    if (ch === "/") {
      // "AFM382/AFM481" — slash between equivalent courses.
      tokens.push({ kind: "OR" });
      i++;
      continue;
    }
    const rest = s.slice(i);

    const oneOfMatch = rest.match(ONE_OF_RE);
    if (oneOfMatch) {
      tokens.push({ kind: "ONE_OF" });
      i += oneOfMatch[0].length;
      continue;
    }

    const levelMatch = rest.match(LEVEL_RE);
    if (levelMatch) {
      tokens.push({ kind: "LEVEL", minLevel: levelMatch[1].toUpperCase() });
      i += levelMatch[0].length;
      continue;
    }

    const courseMatch = rest.match(COURSE_RE);
    if (courseMatch) {
      tokens.push({
        kind: "COURSE",
        code: `${courseMatch[1]}${courseMatch[2]}`.toLowerCase(),
      });
      i += courseMatch[0].length;
      continue;
    }

    const orMatch = rest.match(OR_RE);
    if (orMatch) {
      tokens.push({ kind: "OR" });
      i += orMatch[0].length;
      continue;
    }

    const andMatch = rest.match(AND_RE);
    if (andMatch) {
      tokens.push({ kind: "AND" });
      i += andMatch[0].length;
      continue;
    }

    // Everything else: grab a run of word chars + spaces as RAW.
    const rawMatch = rest.match(/^[^(),;\/]+/);
    if (rawMatch) {
      const raw = rawMatch[0].trim();
      if (raw.length > 0) tokens.push({ kind: "RAW", text: raw });
      i += rawMatch[0].length;
      continue;
    }
    i++;
  }
  tokens.push({ kind: "END" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private consume(): Token {
    return this.tokens[this.pos++];
  }
  private match(kind: Token["kind"]): boolean {
    if (this.peek().kind === kind) {
      this.consume();
      return true;
    }
    return false;
  }

  parseExpression(): PrereqNode {
    const clauses: PrereqNode[] = [this.parseAndClause()];
    while (this.match("SEMI")) {
      clauses.push(this.parseAndClause());
    }
    return clauses.length === 1 ? clauses[0] : flatten("and", clauses);
  }

  parseAndClause(): PrereqNode {
    const parts: PrereqNode[] = [this.parseOrClause()];
    while (this.match("AND")) {
      parts.push(this.parseOrClause());
    }
    return parts.length === 1 ? parts[0] : flatten("and", parts);
  }

  parseOrClause(): PrereqNode {
    const parts: PrereqNode[] = [this.parsePrimary()];
    while (this.match("OR")) {
      parts.push(this.parsePrimary());
    }
    return parts.length === 1 ? parts[0] : flatten("or", parts);
  }

  parsePrimary(): PrereqNode {
    const tok = this.peek();
    if (tok.kind === "COURSE") {
      this.consume();
      return { kind: "course", code: tok.code };
    }
    if (tok.kind === "LEVEL") {
      this.consume();
      return { kind: "level", minLevel: tok.minLevel };
    }
    if (tok.kind === "ONE_OF") {
      this.consume();
      const list: PrereqNode[] = [];
      const first = this.parseOneOfItem();
      if (first) list.push(first);
      while (this.match("COMMA")) {
        const next = this.parseOneOfItem();
        if (next) list.push(next);
      }
      if (list.length === 0) return { kind: "raw", text: "one of (empty)" };
      if (list.length === 1) return list[0];
      return flatten("or", list);
    }
    if (tok.kind === "LPAREN") {
      this.consume();
      const inner = this.parseExpression();
      this.match("RPAREN");
      return inner;
    }
    if (tok.kind === "RAW") {
      this.consume();
      return { kind: "raw", text: tok.text };
    }
    if (tok.kind !== "END") this.consume();
    return { kind: "raw", text: "" };
  }

  /**
   * "one of A, B, (C or D)" — each comma-separated item may itself be a
   * parenthesized expression, so recurse via parsePrimary for LPAREN.
   */
  private parseOneOfItem(): PrereqNode | null {
    const tok = this.peek();
    if (tok.kind === "COMMA" || tok.kind === "END" || tok.kind === "SEMI") {
      return null;
    }
    if (tok.kind === "LPAREN") return this.parsePrimary();
    if (tok.kind === "COURSE") {
      this.consume();
      return { kind: "course", code: tok.code };
    }
    if (tok.kind === "RAW") {
      this.consume();
      return { kind: "raw", text: tok.text };
    }
    this.consume();
    return null;
  }
}

function flatten(
  kind: "and" | "or",
  children: PrereqNode[],
): PrereqNode {
  const dropEmpty = children.filter(
    (c) => !(c.kind === "raw" && c.text === ""),
  );
  if (dropEmpty.length === 0) return { kind: "raw", text: "" };
  if (dropEmpty.length === 1) return dropEmpty[0];
  const flat: PrereqNode[] = [];
  for (const c of dropEmpty) {
    if (c.kind === kind) flat.push(...c.children);
    else flat.push(c);
  }
  return { kind, children: flat };
}

export function parsePrereqs(text: string | null | undefined): PrereqNode | null {
  if (!text || text.trim() === "") return null;
  const tokens = tokenize(text);
  const parser = new Parser(tokens);
  return parser.parseExpression();
}
