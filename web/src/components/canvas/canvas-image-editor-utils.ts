export type EditorPoint = { x: number; y: number };
export type EditorMatrix = [number, number, number, number, number, number];

type EditorObjectBase = { id: string };

type EditorStrokeBase = EditorObjectBase & {
    points: EditorPoint[];
    color: string;
    width: number;
    softness: number;
};

export type EditorStroke = (EditorStrokeBase & { type: "brush" }) | (EditorStrokeBase & { type: "erase" });

export type EditorArrow = EditorObjectBase & {
    type: "arrow";
    start: EditorPoint;
    end: EditorPoint;
    color: string;
    width: number;
};

export type EditorRect = EditorObjectBase & {
    type: "rect";
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    strokeWidth: number;
    fill: boolean;
};

export type EditorText = EditorObjectBase & {
    type: "text";
    x: number;
    y: number;
    text: string;
    color: string;
    size: number;
};

export type EditorMosaic = EditorObjectBase & {
    type: "mosaic";
    x: number;
    y: number;
    width: number;
    height: number;
    block: number;
};

export type EditorObject = EditorStroke | EditorArrow | EditorRect | EditorText | EditorMosaic;

export type EditorSnapshot = {
    width: number;
    height: number;
    matrix: EditorMatrix;
    objects: EditorObject[];
};

export type EditorRectValue = { x: number; y: number; width: number; height: number };

export const identityEditorMatrix: EditorMatrix = [1, 0, 0, 1, 0, 0];

export function renderEditorScene(canvas: HTMLCanvasElement, image: HTMLImageElement, snapshot: EditorSnapshot, draft?: EditorObject | null, selectedId?: string | null, selectionColor = "#2563eb", hiddenId?: string) {
    const scaleX = canvas.width / Math.max(1, snapshot.width);
    const scaleY = canvas.height / Math.max(1, snapshot.height);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.save();
    context.transform(...snapshot.matrix);
    context.drawImage(image, 0, 0);
    context.restore();

    const overlay = document.createElement("canvas");
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;
    overlayContext.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    const visibleObjects = hiddenId ? snapshot.objects.filter((object) => object.id !== hiddenId) : snapshot.objects;
    for (const object of draft ? [...visibleObjects, draft] : visibleObjects) {
        drawEditorObject(overlayContext, object, canvas, scaleX, scaleY);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(overlay, 0, 0);

    if (selectedId) {
        const selected = snapshot.objects.find((object) => object.id === selectedId);
        if (selected) drawSelection(context, editorObjectBounds(selected), scaleX, scaleY, selectionColor);
    }
}

export function exportEditorBlob(image: HTMLImageElement, snapshot: EditorSnapshot) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(snapshot.width));
    canvas.height = Math.max(1, Math.round(snapshot.height));
    renderEditorScene(canvas, image, snapshot);
    return new Promise<Blob>((resolve, reject) => {
        try {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image export failed"))), "image/png");
        } catch (error) {
            reject(error);
        }
    });
}

function drawEditorObject(context: CanvasRenderingContext2D, object: EditorObject, base: HTMLCanvasElement, scaleX: number, scaleY: number) {
    context.save();
    if (object.type === "brush" || object.type === "erase") {
        if (object.points.length < 2) return context.restore();
        context.globalCompositeOperation = object.type === "erase" ? "destination-out" : "source-over";
        context.strokeStyle = object.type === "erase" ? "#000" : object.color;
        context.lineCap = "round";
        context.lineJoin = "round";
        const core = Math.max(1, object.width * (1 - object.softness));
        const passes = object.softness <= 0.02 ? [{ width: object.width, alpha: 1 }] : [...Array.from({ length: 7 }, (_, index) => ({ width: object.width - ((object.width - core) * index) / 6, alpha: 0.32 })), { width: core, alpha: 1 }];
        passes.forEach((pass) => {
            context.globalAlpha = pass.alpha;
            context.lineWidth = Math.max(0.5, pass.width);
            context.beginPath();
            context.moveTo(object.points[0].x, object.points[0].y);
            object.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
            context.stroke();
        });
    } else if (object.type === "arrow") {
        drawArrow(context, object);
    } else if (object.type === "rect") {
        context.strokeStyle = object.color;
        context.fillStyle = object.color;
        context.lineWidth = object.strokeWidth;
        context.lineJoin = "round";
        if (object.fill) context.fillRect(object.x, object.y, object.width, object.height);
        else context.strokeRect(object.x, object.y, object.width, object.height);
    } else if (object.type === "text") {
        context.fillStyle = object.color;
        context.font = `700 ${object.size}px sans-serif`;
        context.textBaseline = "alphabetic";
        object.text.split("\n").forEach((line, index) => context.fillText(line, object.x, object.y + index * object.size * 1.2));
    } else {
        drawMosaic(context, object, base, scaleX, scaleY);
    }
    context.restore();
}

function drawArrow(context: CanvasRenderingContext2D, arrow: EditorArrow) {
    const angle = Math.atan2(arrow.end.y - arrow.start.y, arrow.end.x - arrow.start.x);
    const head = arrow.width * 3.5 + 8;
    const shaftEnd = { x: arrow.end.x - Math.cos(angle) * head * 0.75, y: arrow.end.y - Math.sin(angle) * head * 0.75 };
    context.strokeStyle = arrow.color;
    context.fillStyle = arrow.color;
    context.lineWidth = arrow.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(arrow.start.x, arrow.start.y);
    context.lineTo(shaftEnd.x, shaftEnd.y);
    context.stroke();
    context.beginPath();
    context.moveTo(arrow.end.x, arrow.end.y);
    context.lineTo(arrow.end.x - head * Math.cos(angle - 0.48), arrow.end.y - head * Math.sin(angle - 0.48));
    context.lineTo(arrow.end.x - head * Math.cos(angle + 0.48), arrow.end.y - head * Math.sin(angle + 0.48));
    context.closePath();
    context.fill();
}

function drawMosaic(context: CanvasRenderingContext2D, mosaic: EditorMosaic, base: HTMLCanvasElement, scaleX: number, scaleY: number) {
    const x = Math.round(mosaic.x * scaleX);
    const y = Math.round(mosaic.y * scaleY);
    const width = Math.max(1, Math.round(mosaic.width * scaleX));
    const height = Math.max(1, Math.round(mosaic.height * scaleY));
    const block = Math.max(2, Math.round(mosaic.block * Math.max(scaleX, scaleY)));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.ceil(width / block));
    small.height = Math.max(1, Math.ceil(height / block));
    const smallContext = small.getContext("2d");
    if (!smallContext) return;
    smallContext.drawImage(base, x, y, width, height, 0, 0, small.width, small.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
    context.imageSmoothingEnabled = true;
}

function drawSelection(context: CanvasRenderingContext2D, bounds: EditorRectValue, scaleX: number, scaleY: number, color: string) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash([5, 4]);
    context.strokeRect(bounds.x * scaleX - 4, bounds.y * scaleY - 4, bounds.width * scaleX + 8, bounds.height * scaleY + 8);
    context.restore();
}

export function editorObjectBounds(object: EditorObject): EditorRectValue {
    if (object.type === "brush" || object.type === "erase") {
        const xs = object.points.map((point) => point.x);
        const ys = object.points.map((point) => point.y);
        const padding = object.width / 2;
        return rectFromEdges(Math.min(...xs) - padding, Math.min(...ys) - padding, Math.max(...xs) + padding, Math.max(...ys) + padding);
    }
    if (object.type === "arrow") {
        const padding = object.width * 4 + 8;
        return rectFromEdges(Math.min(object.start.x, object.end.x) - padding, Math.min(object.start.y, object.end.y) - padding, Math.max(object.start.x, object.end.x) + padding, Math.max(object.start.y, object.end.y) + padding);
    }
    if (object.type === "text") {
        const lines = object.text.split("\n");
        return { x: object.x, y: object.y - object.size, width: Math.max(object.size, ...lines.map((line) => line.length * object.size * 0.62)), height: object.size * (1 + Math.max(0, lines.length - 1) * 1.2) };
    }
    return normalizeRect(object);
}

export function hitEditorObject(object: EditorObject, point: EditorPoint, tolerance: number) {
    if (object.type === "erase") return false;
    if (object.type === "brush") {
        return object.points.some((current, index) => index > 0 && distanceToSegment(point, object.points[index - 1], current) <= object.width / 2 + tolerance);
    }
    if (object.type === "arrow") return distanceToSegment(point, object.start, object.end) <= object.width / 2 + tolerance * 2;
    const bounds = editorObjectBounds(object);
    return point.x >= bounds.x - tolerance && point.x <= bounds.x + bounds.width + tolerance && point.y >= bounds.y - tolerance && point.y <= bounds.y + bounds.height + tolerance;
}

export function translateEditorObject(object: EditorObject, dx: number, dy: number): EditorObject {
    if (object.type === "brush" || object.type === "erase") return { ...object, points: object.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    if (object.type === "arrow") return { ...object, start: { x: object.start.x + dx, y: object.start.y + dy }, end: { x: object.end.x + dx, y: object.end.y + dy } };
    return { ...object, x: object.x + dx, y: object.y + dy };
}

export function rotateEditorSnapshot(snapshot: EditorSnapshot, clockwise: boolean): EditorSnapshot {
    const operation: EditorMatrix = clockwise ? [0, 1, -1, 0, snapshot.height, 0] : [0, -1, 1, 0, 0, snapshot.width];
    return transformEditorSnapshot(snapshot, operation, snapshot.height, snapshot.width);
}

export function flipEditorSnapshot(snapshot: EditorSnapshot, horizontal: boolean): EditorSnapshot {
    const operation: EditorMatrix = horizontal ? [-1, 0, 0, 1, snapshot.width, 0] : [1, 0, 0, -1, 0, snapshot.height];
    return transformEditorSnapshot(snapshot, operation, snapshot.width, snapshot.height);
}

export function cropEditorSnapshot(snapshot: EditorSnapshot, crop: EditorRectValue): EditorSnapshot {
    const normalized = normalizeRect(crop);
    const x = Math.max(0, Math.round(normalized.x));
    const y = Math.max(0, Math.round(normalized.y));
    const width = Math.max(1, Math.min(snapshot.width - x, Math.round(normalized.width)));
    const height = Math.max(1, Math.min(snapshot.height - y, Math.round(normalized.height)));
    return transformEditorSnapshot(snapshot, [1, 0, 0, 1, -x, -y], width, height);
}

function transformEditorSnapshot(snapshot: EditorSnapshot, operation: EditorMatrix, width: number, height: number): EditorSnapshot {
    return {
        width,
        height,
        matrix: multiplyMatrix(operation, snapshot.matrix),
        objects: snapshot.objects.map((object) => transformEditorObject(object, operation)),
    };
}

function transformEditorObject(object: EditorObject, matrix: EditorMatrix): EditorObject {
    if (object.type === "brush" || object.type === "erase") return { ...object, points: object.points.map((point) => transformPoint(point, matrix)) };
    if (object.type === "arrow") return { ...object, start: transformPoint(object.start, matrix), end: transformPoint(object.end, matrix) };
    if (object.type === "text") return { ...object, ...transformPoint({ x: object.x, y: object.y }, matrix) };
    const bounds = transformRect(object, matrix);
    return { ...object, ...bounds };
}

function transformRect(rect: EditorRectValue, matrix: EditorMatrix) {
    const corners = [
        transformPoint({ x: rect.x, y: rect.y }, matrix),
        transformPoint({ x: rect.x + rect.width, y: rect.y }, matrix),
        transformPoint({ x: rect.x, y: rect.y + rect.height }, matrix),
        transformPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, matrix),
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    return rectFromEdges(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

function transformPoint(point: EditorPoint, matrix: EditorMatrix): EditorPoint {
    const [a, b, c, d, e, f] = matrix;
    return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

function multiplyMatrix(left: EditorMatrix, right: EditorMatrix): EditorMatrix {
    const [a1, b1, c1, d1, e1, f1] = left;
    const [a2, b2, c2, d2, e2, f2] = right;
    return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

function normalizeRect(rect: EditorRectValue): EditorRectValue {
    const x = rect.width < 0 ? rect.x + rect.width : rect.x;
    const y = rect.height < 0 ? rect.y + rect.height : rect.y;
    return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

function rectFromEdges(left: number, top: number, right: number, bottom: number): EditorRectValue {
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function distanceToSegment(point: EditorPoint, start: EditorPoint, end: EditorPoint) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

