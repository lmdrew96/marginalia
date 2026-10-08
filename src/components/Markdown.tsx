import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MdNode = { type: string; value?: string; children?: MdNode[] };

// Longest first, so "<->" isn't read as "<-" followed by ">".
const ARROWS: [RegExp, string][] = [
  [/<=>/g, "⇔"],
  [/<->/g, "↔"],
  [/=>/g, "⇒"],
  [/->/g, "→"],
  [/<-/g, "←"],
];

/**
 * Typed arrows ("->", "=>", …) as arrow characters. Only plain text is
 * touched: code spans and code blocks are separate node types, so their
 * arrows stay literal.
 */
const remarkArrows = () => (tree: MdNode): void => {
  const visit = (node: MdNode): void => {
    if (node.type === "text" && node.value) {
      node.value = ARROWS.reduce((s, [re, arrow]) => s.replace(re, arrow), node.value);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
};

/**
 * Renders user- or AI-written markdown. react-markdown never renders raw
 * HTML from the source and strips unsafe link protocols by default, so the
 * output needs no further sanitizing. Styles live under `.markdown` in
 * globals.css.
 */
export const Markdown = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.JSX.Element => (
  <div className={`markdown ${className ?? ""}`}>
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkArrows]}>{children}</ReactMarkdown>
  </div>
);
