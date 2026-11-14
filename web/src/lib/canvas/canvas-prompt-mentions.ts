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
