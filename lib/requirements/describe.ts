import type { RuleNode } from "./types";

/**
 * Derive display prose for a rule node from its structure. The scraper omits
 * these standard phrasings from `data/programs.json` to keep it small.
 * Returns `undefined` for `courses` leaves and nodes whose stored `description`
 * should win.
 */
export function describeRule(node: RuleNode): string | undefined {
  switch (node.kind) {
    case "courses":
      return undefined;
    case "all":
      return node.description ?? "Complete all of the following";
    case "excluded":
      return (
        node.description ??
        "The following cannot be used towards this academic plan"
      );
    case "pick": {
      if (node.description !== undefined) return node.description;
      const { selectMin, selectMax, children } = node;
      if (selectMin === undefined && selectMax === undefined) {
        return "Choose any of the following";
      }
      if (selectMin === undefined && selectMax !== undefined) {
        return `Complete no more than ${selectMax} from the following`;
      }
      // metaParent (children are rules, not a single `courses` leaf) uses the
      // "from … choices" phrasing; the leaf form uses "of the following".
      const isMetaParent =
        children.length !== 1 || children[0].kind !== "courses";
      if (selectMin === selectMax && selectMin !== undefined) {
        const noun = selectMin === 1 ? "course" : "courses";
        return isMetaParent
          ? `Complete ${selectMin} ${noun} from the following choices`
          : `Complete ${selectMin} of the following`;
      }
      if (selectMin !== undefined && selectMax === undefined) {
        const noun = selectMin === 1 ? "course" : "courses";
        return isMetaParent
          ? `Complete at least ${selectMin} ${noun} from the following choices`
          : `Complete at least ${selectMin} of the following`;
      }
      // Both bounds defined and unequal (equal case handled above).
      return isMetaParent
        ? `Complete between ${selectMin} and ${selectMax} courses from the following choices`
        : `Complete between ${selectMin} and ${selectMax} of the following`;
    }
    case "subjectPool": {
      if (node.description !== undefined) return node.description;
      const singleSubject =
        node.subjectCodes.length === 1 ? `${node.subjectCodes[0]} ` : "";
      const level =
        node.minLevel !== undefined && node.maxLevel !== undefined
          ? ` at the ${node.minLevel}- or ${node.maxLevel}-level`
          : node.minLevel !== undefined
            ? ` at the ${node.minLevel}-level`
            : "";
      const fromList =
        node.subjectCodes.length > 1
          ? ` from: ${node.subjectCodes.join(", ")}`
          : "";
      const exclusions =
        node.exclusions && node.exclusions.length > 0
          ? `; ${node.exclusions.join("; ")}`
          : "";
      const noun = node.selectCount === 1 ? "course" : "courses";
      return `Complete ${node.selectCount} additional ${singleSubject}${noun}${level}${fromList}${exclusions}`;
    }
  }
}
