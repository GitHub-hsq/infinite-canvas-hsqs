import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Scissors } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function ConnectionPath({
    connection,
    from,
    to,
    active,
    selected,
    scale,
    onSelect,
    onDelete,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    active: boolean;
    selected: boolean;
    scale: number;
    onSelect: () => void;
    onDelete: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [cutPoint, setCutPoint] = useState<Position | null>(null);
    const startX = from.position.x + from.width;
    const startY = from.position.y + from.height / 2;
    const endX = to.position.x;
    const endY = to.position.y + to.height / 2;
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    const pathD = `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
    const controlSize = 32 / Math.max(scale, 0.01);

    return (
        <g>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(event) => {
                    event.stopPropagation();
                    const svg = event.currentTarget.ownerSVGElement;
                    const matrix = svg?.getScreenCTM()?.inverse();
                    if (svg && matrix) {
                        const point = svg.createSVGPoint();
                        point.x = event.clientX;
                        point.y = event.clientY;
                        const local = point.matrixTransform(matrix);
                        setCutPoint({ x: local.x, y: local.y });
                    }
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            <path
                d={pathD}
                stroke={active ? theme.connection.activeStroke : theme.connection.stroke}
                strokeWidth={active ? 3 : 2}
                fill="none"
                style={{ filter: active ? `drop-shadow(0 0 5px ${theme.connection.activeStroke}55)` : undefined, pointerEvents: "none" }}
            />
            {selected && cutPoint ? (
                <foreignObject x={cutPoint.x - controlSize / 2} y={cutPoint.y - controlSize / 2} width={controlSize} height={controlSize} style={{ overflow: "visible", pointerEvents: "all" }}>
                    <button
                        type="button"
                        className="grid size-full cursor-pointer place-items-center rounded-full border shadow-lg transition hover:scale-105"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: "#ef4444" }}
                        aria-label="切断连线"
                        title="切断连线"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onDelete();
                        }}
                    >
                        <Scissors style={{ width: controlSize * 0.5, height: controlSize * 0.5 }} />
                    </button>
                </foreignObject>
            ) : null}
        </g>
    );
}

export function ActiveConnectionPath({ node, handle, mouseWorld, target }: { node?: CanvasNodeData; handle: ConnectionHandle; mouseWorld: Position; target?: CanvasNodeData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (!node) return null;

    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? node.position.y + node.height / 2 : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : node.position.y + node.height / 2;
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? target.position.y + target.height / 2 : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? target.position.y + target.height / 2 : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    const pathD = `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;

    return <path d={pathD} stroke={theme.connection.activeStroke} strokeWidth="2" fill="none" strokeDasharray="5,5" />;
}
