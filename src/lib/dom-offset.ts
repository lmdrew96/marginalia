function textWalker(root: Node): TreeWalker {
  // No filter beyond SHOW_TEXT — this must descend into existing <mark>
  // elements too, or offsets computed after the first highlight will be
  // wrong for every highlight after it in that paragraph.
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
}

export function getOffsetInRoot(
  root: Node,
  target: Node,
  targetOffset: number,
): number {
  const walker = textWalker(root);
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === target) {
      return offset + targetOffset;
    }
    offset += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return offset;
}

export function findRangeForOffsets(
  root: Node,
  start: number,
  end: number,
): Range | null {
  const walker = textWalker(root);
  let offset = 0;
  let startNode: Text | null = null;
  let startNodeOffset = 0;
  let endNode: Text | null = null;
  let endNodeOffset = 0;

  let lastNode: Text | null = null;
  let lastNodeLength = 0;

  let current = walker.nextNode() as Text | null;
  while (current) {
    const length = current.textContent?.length ?? 0;
    const nodeStart = offset;
    const nodeEnd = offset + length;

    // A boundary offset (start === nodeEnd of this node) must snap FORWARD
    // to the start of the next node, not the end of this one — otherwise a
    // range can begin at the tail of one paragraph and extend into the
    // next, wrapping a <mark> around block elements. End does the opposite:
    // it snaps BACKWARD to the end of this node rather than the start of
    // the next, so a highlight that stops exactly at a paragraph boundary
    // doesn't spill into the following paragraph either.
    if (startNode === null && start >= nodeStart && start < nodeEnd) {
      startNode = current;
      startNodeOffset = start - nodeStart;
    }
    if (endNode === null && end > nodeStart && end <= nodeEnd) {
      endNode = current;
      endNodeOffset = end - nodeStart;
    }
    if (startNode && endNode) break;

    lastNode = current;
    lastNodeLength = length;
    offset = nodeEnd;
    current = walker.nextNode() as Text | null;
  }

  // start/end pointing exactly at the very end of all text content (e.g.
  // a highlight reaching the last character of the document).
  if (startNode === null && lastNode && start === offset) {
    startNode = lastNode;
    startNodeOffset = lastNodeLength;
  }
  if (endNode === null && lastNode && end === offset) {
    endNode = lastNode;
    endNodeOffset = lastNodeLength;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  return range;
}

export function wrapRangeInMark(
  range: Range,
  backgroundColor: string,
  highlightId: string,
): HTMLElement {
  const mark = document.createElement("mark");
  mark.style.backgroundColor = backgroundColor;
  mark.style.color = "inherit";
  mark.dataset.highlightId = highlightId;
  const contents = range.extractContents();
  mark.appendChild(contents);
  range.insertNode(mark);
  return mark;
}

export function unwrapMark(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}

export function getTopVisibleOffset(root: Node): number | null {
  const walker = textWalker(root);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = node.textContent ?? "";
    if (text.trim().length > 0) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.bottom > 0) {
        return getOffsetInRoot(root, node, 0);
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return null;
}
