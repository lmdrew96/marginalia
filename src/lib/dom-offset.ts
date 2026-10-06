function textWalker(root: Node): TreeWalker {
  // Every text node under root, in document order — the same concatenation
  // Range.toString() produces, so offsets from getOffsetInRoot line up.
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
}

/**
 * Character offset of a DOM point within `root`'s text — the same count
 * findRangeForOffsets walks. Uses a Range instead of matching text nodes so
 * it also handles points on element nodes (a selection ending between two
 * pdf.js text-layer spans lands on the layer div, not a text node). A point
 * outside `root` clamps to its start or end.
 */
export function getOffsetInRoot(
  root: Node,
  target: Node,
  targetOffset: number,
): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  if (!root.contains(target)) {
    const after =
      root.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING;
    return after ? range.toString().length : 0;
  }
  range.setEnd(target, targetOffset);
  return range.toString().length;
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
