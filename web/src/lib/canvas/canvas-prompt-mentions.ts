import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

/** Fields that can hold `@[node:<id>]` mention tokens. */
const MENTION_FIELDS = ["prompt", "composerContent"] as const;

export function mentionToken(nodeId: string) {
    return `@[node:${nodeId}]`;
}

/** Replace a mention token with a bare "@", dropping the separator space that followed the chip. */
export function dropMentionToken(text: string, nodeId: string) {
    const token = mentionToken(nodeId);
    return text.split(`${token} `).join("@").split(token).join("@");
}

/**
 * A source that was disconnected or deleted can never resolve again: drop it from the saved reference list and
 * degrade its `@` chips to plain "@", which keeps the sentence readable and lets the user type a new mention.
 */
export function dropNodeMention(node: CanvasNodeData, sourceNodeId: string): CanvasNodeData {
    const token = mentionToken(sourceNodeId);
    const metadata = node.metadata;
    const affected = MENTION_FIELDS.filter((key) => typeof metadata?.[key] === "string" && metadata[key]!.includes(token));
    const savedIds = metadata?.referenceNodeIds;
    if (!affected.length && !savedIds?.includes(sourceNodeId)) return node;

    const next: CanvasNodeMetadata = { ...metadata };
    for (const key of affected) next[key] = dropMentionToken(metadata![key]!, sourceNodeId);
    if (savedIds) next.referenceNodeIds = savedIds.filter((id) => id !== sourceNodeId);
    return { ...node, metadata: next };
}

/** Apply {@link dropNodeMention} to every node that mentions the removed sources. */
export function dropRemovedMentions(nodes: CanvasNodeData[], sourceNodeIds: Iterable<string>) {
    const ids = [...sourceNodeIds];
    if (!ids.length) return nodes;
    return nodes.map((node) => ids.reduce((current, id) => dropNodeMention(current, id), node));
}

/** Insert a non-editable reference chip + trailing space in place of the active `@query` without leaving empty text nodes. */
export function insertReferenceChipAtMention(editor: HTMLElement, chip: HTMLElement) {
    const selection = window.getSelection();
    const space = document.createTextNode(" ");
    const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (activeRange && editor.contains(activeRange.startContainer)) {
        removeActiveMention(editor, activeRange);
        // Move off text node edges so Range.insertNode does not split into trailing empty "" text nodes.
        if (activeRange.startContainer.nodeType === Node.TEXT_NODE) {
            const textNode = activeRange.startContainer;
            const length = (textNode.textContent || "").length;
            if (activeRange.startOffset === 0) activeRange.setStartBefore(textNode);
            else if (activeRange.startOffset === length) activeRange.setStartAfter(textNode);
            activeRange.collapse(true);
        }
        activeRange.insertNode(space);
        activeRange.insertNode(chip);
    } else {
        editor.append(chip, space);
    }
    pruneEmptyTextNodes(editor);
    const caret = document.createRange();
    // Anchor the caret inside the trailing space text node rather than at an element boundary so Blink IME compositions commit once.
    caret.setStart(space, space.length);
    caret.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(caret);
    return caret;
}

/** Delete an adjacent atomic reference chip on Backspace/Delete without leaving empty text nodes. */
export function deleteAdjacentReferenceChip(editor: HTMLElement, key: string, isChip: (el: HTMLElement) => boolean) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const target = adjacentChipNode(range, key, isChip);
    if (!target || !target.parentNode) return false;
    const parent = target.parentNode;
    const prev = target.previousSibling;
    const next = target.nextSibling;
    const index = Array.prototype.indexOf.call(parent.childNodes, target);
    target.remove();
    pruneEmptyTextNodes(editor);
    const caret = document.createRange();
    if (prev?.nodeType === Node.TEXT_NODE && prev.parentNode) caret.setStart(prev, (prev.textContent || "").length);
    else if (next?.nodeType === Node.TEXT_NODE && next.parentNode) caret.setStart(next, 0);
    else caret.setStart(parent, Math.min(index, parent.childNodes.length));
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    return true;
}

function removeActiveMention(editor: HTMLElement, range: Range) {
    const prefixRange = range.cloneRange();
    prefixRange.setStart(editor, 0);
    const match = /@([^\s@]*)$/.exec(prefixRange.toString());
    if (!match) return;
    let remaining = (match[1] || "").length + 1;
    if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset >= remaining) {
        range.setStart(range.startContainer, range.startOffset - remaining);
        range.deleteContents();
        return;
    }
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (let i = textNodes.length - 1; i >= 0 && remaining > 0; i--) {
        const node = textNodes[i];
        const cmp = range.comparePoint(node, 0);
        if (cmp > 0) continue;
        const limit = node === range.startContainer ? range.startOffset : (node.textContent || "").length;
        if (limit <= 0) continue;
        const take = Math.min(limit, remaining);
        range.setStart(node, limit - take);
        remaining -= take;
    }
    range.deleteContents();
}

function pruneEmptyTextNodes(root: Node) {
    const empty: Node[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode.textContent === "") empty.push(walker.currentNode);
    }
    empty.forEach((node) => node.parentNode?.removeChild(node));
}

function adjacentChipNode(range: Range, key: string, isChip: (el: HTMLElement) => boolean) {
    const container = range.startContainer;
    const offset = range.startOffset;
    const previous = key === "Backspace";
    if (container.nodeType === Node.TEXT_NODE) {
        const text = container.textContent || "";
        if ((previous && offset > 0) || (!previous && offset < text.length)) return null;
        return findChipSibling(container, previous, false, isChip);
    }
    const children = Array.from(container.childNodes);
    return findChipSibling(children[previous ? offset - 1 : offset] || container, previous, true, isChip);
}

function findChipSibling(node: Node, previous: boolean, includeSelf: boolean, isChip: (el: HTMLElement) => boolean): HTMLElement | null {
    let current: Node | null = includeSelf ? node : previous ? node.previousSibling : node.nextSibling;
    while (current && current.nodeType === Node.TEXT_NODE && !(current.textContent || "").trim()) current = previous ? current.previousSibling : current.nextSibling;
    return current instanceof HTMLElement && isChip(current) ? current : null;
}
