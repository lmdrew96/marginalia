import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </div>
);
