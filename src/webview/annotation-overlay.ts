export type AnnotationTool = 'select' | 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'callout';

export interface AnnotationOverlay {
  setActive(active: boolean): void;
  setTool(tool: AnnotationTool): void;
  setColor(color: string): void;
  undo(): void;
  redo(): void;
  deleteSelection?(): boolean;
  clear(): boolean;
  hasShapes(): boolean;
  composite(screenshotDataUrl: string): Promise<string>;
  destroy(): void;
}

interface Point {
  x: number;
  y: number;
}

type DraftShape = SVGElement | null;
type ShapeType = Exclude<AnnotationTool, 'select'>;

interface ShapeModel {
  id: string;
  type: ShapeType;
  node: SVGElement;
}

interface MoveShapeSnapshot {
  id: string;
  index: number;
  node: SVGElement;
  type: ShapeType;
  pathPoints?: Point[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  indexX?: number;
  indexY?: number;
  labelX?: number;
  labelY?: number;
  radius?: number;
}

interface MoveSession {
  origin: Point;
  snapshots: MoveShapeSnapshot[];
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ResizeSession {
  handle: ResizeHandle;
  anchor: Point;
  startBox: Bounds;
  snapshots: MoveShapeSnapshot[];
}

interface ArrowEndpointSession {
  line: SVGLineElement;
  endpoint: 'start' | 'end';
  snapshot: MoveShapeSnapshot;
}

type HistoryEntry =
  | { kind: 'create'; snapshots: MoveShapeSnapshot[] }
  | { kind: 'delete'; snapshots: MoveShapeSnapshot[] }
  | { kind: 'transform'; before: MoveShapeSnapshot[]; after: MoveShapeSnapshot[] };

interface AnnotationOverlayOptions {
  onSelectionChange?: (hasSelection: boolean) => void;
  log?: (message: string, details?: string) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createAnnotationOverlay(
  iframe = document.getElementById('browser-iframe'),
  options: AnnotationOverlayOptions = {}
): AnnotationOverlay {
  if (!(iframe instanceof HTMLIFrameElement) || !iframe.parentElement) {
    throw new Error('Expected #browser-iframe inside a parent element');
  }

  const log = options.log ?? (() => {});

  const host = iframe.parentElement;
  if (!host.style.position) {
    host.style.position = 'relative';
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', `0 0 ${Math.max(iframe.clientWidth, 1)} ${Math.max(iframe.clientHeight, 1)}`);
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2';

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  host.appendChild(svg);

  const iframeEl = iframe as HTMLIFrameElement;

  function updateViewBox() {
    const w = Math.max(iframeEl.clientWidth, 1);
    const h = Math.max(iframeEl.clientHeight, 1);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  const resizeObserver = new ResizeObserver(updateViewBox);
  resizeObserver.observe(iframeEl);

  let active = false;
  let tool: AnnotationTool = 'pen';
  let color = '#ff3b30';
  let draft: DraftShape = null;
  let origin: Point | null = null;
  let penPoints: Point[] = [];
  let shapes: SVGElement[] = [];
  const shapesById = new Map<string, ShapeModel>();
  const nodeToShapeId = new WeakMap<SVGElement, string>();
  const selection = new Set<string>();
  let undoStack: HistoryEntry[] = [];
  let redoStack: HistoryEntry[] = [];
  let editor: HTMLInputElement | null = null;
  let calloutCounter = 1;
  let nextShapeId = 1;
  let moveSession: MoveSession | null = null;
  let resizeSession: ResizeSession | null = null;
  let arrowEndpointSession: ArrowEndpointSession | null = null;
  let selectionUiNodes: SVGElement[] = [];

  const handleMouseDown = (event: MouseEvent) => {
    log(`mousedown on SVG tool=${tool} active=${active} editor=${!!editor} button=${event.button}`);
    if (!active || editor || event.button !== 0) {
      log(`mousedown BLOCKED active=${active} editor=${!!editor} button=${event.button}`);
      return;
    }

    const point = getPoint(event, svg);
    log(`mousedown point: ${point.x.toFixed(1)},${point.y.toFixed(1)}`);

    if (tool === 'select') {
      handleSelectMouseDown(event, point);
      return;
    }

    origin = point;

    if (tool === 'text') {
      event.preventDefault();
      log(`text tool: calling showEditor at ${point.x.toFixed(1)},${point.y.toFixed(1)}`);
      showEditor(point, (value) => {
        log(`text onCommit value=${JSON.stringify(value)}`);
        if (!value) return;
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(point.x));
        text.setAttribute('y', String(point.y));
        text.setAttribute('fill', color);
        text.setAttribute('font-size', '16');
        text.textContent = value;
        commitShape(text, 'text');
        log('text shape committed');
      });
      origin = null;
      return;
    }

    if (tool === 'callout') {
      event.preventDefault();
      const number = String(calloutCounter);
      showEditor(point, (value) => {
        if (!value) return;
        const group = document.createElementNS(SVG_NS, 'g');

        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute('r', '14');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('fill', '#ffffff');

        const indexText = document.createElementNS(SVG_NS, 'text');
        indexText.setAttribute('x', String(point.x));
        indexText.setAttribute('y', String(point.y + 5));
        indexText.setAttribute('fill', color);
        indexText.setAttribute('font-size', '14');
        indexText.setAttribute('font-weight', '700');
        indexText.setAttribute('text-anchor', 'middle');
        indexText.textContent = number;

        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', String(point.x + 22));
        label.setAttribute('y', String(point.y + 5));
        label.setAttribute('fill', color);
        label.setAttribute('font-size', '16');
        label.textContent = value;

        group.append(circle, indexText, label);
        calloutCounter += 1;
        commitShape(group, 'callout');
      });
      origin = null;
      return;
    }

    if (tool === 'pen') {
      penPoints = [point];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('d', buildPath(penPoints));
      draft = path;
      svg.appendChild(path);
      return;
    }

    draft = createDraftShape(tool as ShapeType, point);
    if (draft) {
      svg.appendChild(draft);
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (tool === 'select' && arrowEndpointSession) {
      const point = getPoint(event, svg);
      applyArrowEndpointDrag(point);
      return;
    }

    if (tool === 'select' && resizeSession) {
      applyResize(event);
      return;
    }

    if (tool === 'select' && moveSession) {
      const point = getPoint(event, svg);
      applyMove(point);
      return;
    }

    if (!origin || !draft) return;
    const point = getPoint(event, svg);

    if (tool === 'pen' && isSvgTag(draft, 'path')) {
      penPoints.push(point);
      draft.setAttribute('d', buildPath(penPoints));
      return;
    }

    updateDraftShape(draft, origin, point);
  };

  const handleMouseUp = (event: MouseEvent) => {
    if (tool === 'select') {
      commitTransformSession();
      moveSession = null;
      resizeSession = null;
      arrowEndpointSession = null;
      cancelDraft();
      renderSelectionHandles();
      return;
    }

    if (!origin || !draft) {
      cancelDraft();
      return;
    }

    const point = getPoint(event, svg);

    if (tool !== 'pen') {
      updateDraftShape(draft, origin, point);
    }

    commitShape(draft, tool as ShapeType);
    draft = null;
    origin = null;
    penPoints = [];
  };

  const handleWindowMouseUp = (event: MouseEvent) => {
    if (tool === 'select' && (moveSession || resizeSession || arrowEndpointSession)) {
      commitTransformSession();
      moveSession = null;
      resizeSession = null;
      arrowEndpointSession = null;
      origin = null;
      renderSelectionHandles();
      return;
    }

    if (!origin || !draft) return;
    handleMouseUp(event);
  };

  svg.addEventListener('mousedown', handleMouseDown);
  svg.addEventListener('mousemove', handleMouseMove);
  svg.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mouseup', handleWindowMouseUp);

  function commitShape(shape: SVGElement, shapeType: ShapeType, recordHistory = true) {
    if (!shape.parentNode) {
      svg.appendChild(shape);
    }
    const id = ensureShapeId(shape);
    shape.dataset.annotationType = shapeType;
    nodeToShapeId.set(shape, id);
    shapesById.set(id, { id, type: shapeType, node: shape });
    shapes.push(shape);
    if (recordHistory) {
      pushHistory({ kind: 'create', snapshots: [toMoveSnapshot({ id, type: shapeType, node: shape })] });
    }
    syncCalloutCounter();
  }

  function pushHistory(entry: HistoryEntry) {
    undoStack.push(entry);
    redoStack = [];
  }

  function ensureShapeId(shape: SVGElement) {
    let id = shape.dataset.annotationId;
    if (!id) {
      id = `shape-${nextShapeId++}`;
      shape.dataset.annotationId = id;
    }
    return id;
  }

  function getShapeType(node: SVGElement) {
    return (node.dataset.annotationType as ShapeType | undefined) ?? inferShapeType(node);
  }

  function getShapeById(id: string) {
    return shapesById.get(id) ?? null;
  }

  function captureSnapshots(ids: string[]) {
    return ids
      .map((id) => getShapeById(id))
      .filter((shape): shape is ShapeModel => Boolean(shape))
      .map((shape) => toMoveSnapshot(shape));
  }

  function handleSelectMouseDown(event: MouseEvent, point: Point) {
    if (event.target instanceof Element) {
      const resizeHandle = event.target.closest('[data-resize-handle]') as SVGElement | null;
      if (resizeHandle) {
        beginResize(resizeHandle.dataset.resizeHandle as ResizeHandle);
        return;
      }

      const endpointHandle = event.target.closest('[data-arrow-endpoint]') as SVGElement | null;
      if (endpointHandle) {
        beginArrowEndpointDrag(endpointHandle);
        return;
      }
    }

    const hit = findShapeAtPoint(point);

    if (!hit) {
      if (!event.shiftKey) {
        setSelection([]);
      }
      return;
    }

    if (event.shiftKey) {
      toggleSelection(hit.id);
      return;
    }

    if (!selection.has(hit.id)) {
      setSelection([hit.id]);
    }

    const snapshots = Array.from(selection)
      .map((id) => shapesById.get(id))
      .filter((shape): shape is ShapeModel => Boolean(shape))
      .map((shape) => toMoveSnapshot(shape));

    if (snapshots.length === 0) {
      return;
    }

    origin = point;
    moveSession = { origin: point, snapshots };
  }

  function beginResize(handle: ResizeHandle) {
    if (selection.size === 0) {
      return;
    }

    const startBox = getSelectionBounds();
    if (!startBox) {
      return;
    }

    const snapshots = Array.from(selection)
      .map((id) => shapesById.get(id))
      .filter((shape): shape is ShapeModel => Boolean(shape))
      .map((shape) => toMoveSnapshot(shape));

    if (snapshots.length === 0) {
      return;
    }

    resizeSession = {
      handle,
      anchor: getResizeAnchor(startBox, handle),
      startBox,
      snapshots,
    };
    moveSession = null;
    arrowEndpointSession = null;
  }

  function applyResize(event: MouseEvent) {
    if (!resizeSession) {
      return;
    }

    const point = getPoint(event, svg);
    const box = getResizedBounds(resizeSession, point, event.shiftKey);
    const startWidth = Math.max(resizeSession.startBox.right - resizeSession.startBox.left, 0.01);
    const startHeight = Math.max(resizeSession.startBox.bottom - resizeSession.startBox.top, 0.01);
    const scaleX = Math.max((box.right - box.left) / startWidth, 0.01);
    const scaleY = Math.max((box.bottom - box.top) / startHeight, 0.01);

    for (const snapshot of resizeSession.snapshots) {
      applyResizeSnapshot(snapshot, resizeSession.startBox, box, scaleX, scaleY);
    }
    renderSelectionHandles();
  }

  function beginArrowEndpointDrag(handleNode: SVGElement) {
    if (selection.size !== 1) {
      return;
    }

    const endpoint = handleNode.dataset.arrowEndpoint;
    const shapeId = handleNode.dataset.shapeId;
    if (!shapeId || (endpoint !== 'start' && endpoint !== 'end')) {
      return;
    }

    const shape = shapesById.get(shapeId);
    if (!shape || !isSvgTag(shape.node, 'line')) {
      return;
    }

    arrowEndpointSession = {
      line: shape.node as SVGLineElement,
      endpoint,
      snapshot: toMoveSnapshot(shape),
    };
    moveSession = null;
    resizeSession = null;
  }

  function applyArrowEndpointDrag(point: Point) {
    if (!arrowEndpointSession) {
      return;
    }

    if (arrowEndpointSession.endpoint === 'start') {
      arrowEndpointSession.line.setAttribute('x1', String(point.x));
      arrowEndpointSession.line.setAttribute('y1', String(point.y));
    } else {
      arrowEndpointSession.line.setAttribute('x2', String(point.x));
      arrowEndpointSession.line.setAttribute('y2', String(point.y));
    }
    renderSelectionHandles();
  }

  function applyMove(point: Point) {
    if (!moveSession) {
      return;
    }

    const deltaX = point.x - moveSession.origin.x;
    const deltaY = point.y - moveSession.origin.y;
    for (const snapshot of moveSession.snapshots) {
      applyMoveSnapshot(snapshot, deltaX, deltaY);
    }
    renderSelectionHandles();
  }

  function commitTransformSession() {
    if (moveSession) {
      commitTransform(moveSession.snapshots);
      return;
    }

    if (resizeSession) {
      commitTransform(resizeSession.snapshots);
      return;
    }

    if (arrowEndpointSession) {
      commitTransform([arrowEndpointSession.snapshot]);
    }
  }

  function commitTransform(before: MoveShapeSnapshot[]) {
    const ids = before.map((snapshot) => snapshot.id);
    const after = captureSnapshots(ids);
    if (after.length !== before.length) {
      return;
    }
    const changed = before.some((snapshot, index) => !sameGeometry(snapshot, after[index]));
    if (changed) {
      pushHistory({ kind: 'transform', before, after });
    }
  }

  function toMoveSnapshot(shape: ShapeModel): MoveShapeSnapshot {
    const node = shape.node;
    const index = Math.max(shapes.indexOf(node), 0);
    const base = {
      id: shape.id,
      index,
      node,
      type: shape.type,
    } as const;

    if (shape.type === 'pen') {
      return {
        ...base,
        pathPoints: parsePathPoints(node.getAttribute('d')),
      };
    }

    if (shape.type === 'rect') {
      return {
        ...base,
        x: toNumber(node.getAttribute('x')),
        y: toNumber(node.getAttribute('y')),
        width: toNumber(node.getAttribute('width')),
        height: toNumber(node.getAttribute('height')),
      };
    }

    if (shape.type === 'ellipse') {
      return {
        ...base,
        cx: toNumber(node.getAttribute('cx')),
        cy: toNumber(node.getAttribute('cy')),
        rx: toNumber(node.getAttribute('rx')),
        ry: toNumber(node.getAttribute('ry')),
      };
    }

    if (shape.type === 'arrow') {
      return {
        ...base,
        x1: toNumber(node.getAttribute('x1')),
        y1: toNumber(node.getAttribute('y1')),
        x2: toNumber(node.getAttribute('x2')),
        y2: toNumber(node.getAttribute('y2')),
      };
    }

    if (shape.type === 'text') {
      return {
        ...base,
        x: toNumber(node.getAttribute('x')),
        y: toNumber(node.getAttribute('y')),
      };
    }

    const circle = node.querySelector('circle');
    const texts = node.querySelectorAll('text');
    const indexText = texts[0] ?? null;
    const label = texts[1] ?? null;

    return {
      ...base,
      cx: toNumber(circle?.getAttribute('cx') ?? null),
      cy: toNumber(circle?.getAttribute('cy') ?? null),
      indexX: toNumber(indexText?.getAttribute('x') ?? null),
      indexY: toNumber(indexText?.getAttribute('y') ?? null),
      labelX: toNumber(label?.getAttribute('x') ?? null),
      labelY: toNumber(label?.getAttribute('y') ?? null),
      radius: toNumber(circle?.getAttribute('r') ?? null),
    };
  }

  function applyResizeSnapshot(
    snapshot: MoveShapeSnapshot,
    startBox: Bounds,
    nextBox: Bounds,
    scaleX: number,
    scaleY: number,
  ) {
    if (snapshot.type === 'pen') {
      const points = (snapshot.pathPoints ?? []).map((point) => ({
        x: nextBox.left + (point.x - startBox.left) * scaleX,
        y: nextBox.top + (point.y - startBox.top) * scaleY,
      }));
      snapshot.node.setAttribute('d', buildPath(points));
      return;
    }

    if (snapshot.type === 'rect') {
      const x = nextBox.left + ((snapshot.x ?? 0) - startBox.left) * scaleX;
      const y = nextBox.top + ((snapshot.y ?? 0) - startBox.top) * scaleY;
      const width = Math.max((snapshot.width ?? 0) * scaleX, 0);
      const height = Math.max((snapshot.height ?? 0) * scaleY, 0);
      snapshot.node.setAttribute('x', String(x));
      snapshot.node.setAttribute('y', String(y));
      snapshot.node.setAttribute('width', String(width));
      snapshot.node.setAttribute('height', String(height));
      return;
    }

    if (snapshot.type === 'ellipse') {
      const cx = nextBox.left + ((snapshot.cx ?? 0) - startBox.left) * scaleX;
      const cy = nextBox.top + ((snapshot.cy ?? 0) - startBox.top) * scaleY;
      snapshot.node.setAttribute('cx', String(cx));
      snapshot.node.setAttribute('cy', String(cy));
      snapshot.node.setAttribute('rx', String(Math.max((snapshot.rx ?? 0) * scaleX, 0)));
      snapshot.node.setAttribute('ry', String(Math.max((snapshot.ry ?? 0) * scaleY, 0)));
      return;
    }

    if (snapshot.type === 'arrow') {
      const x1 = nextBox.left + ((snapshot.x1 ?? 0) - startBox.left) * scaleX;
      const y1 = nextBox.top + ((snapshot.y1 ?? 0) - startBox.top) * scaleY;
      const x2 = nextBox.left + ((snapshot.x2 ?? 0) - startBox.left) * scaleX;
      const y2 = nextBox.top + ((snapshot.y2 ?? 0) - startBox.top) * scaleY;
      snapshot.node.setAttribute('x1', String(x1));
      snapshot.node.setAttribute('y1', String(y1));
      snapshot.node.setAttribute('x2', String(x2));
      snapshot.node.setAttribute('y2', String(y2));
      return;
    }

    if (snapshot.type === 'text') {
      const x = nextBox.left + ((snapshot.x ?? 0) - startBox.left) * scaleX;
      const y = nextBox.top + ((snapshot.y ?? 0) - startBox.top) * scaleY;
      snapshot.node.setAttribute('x', String(x));
      snapshot.node.setAttribute('y', String(y));
      return;
    }

    const circle = snapshot.node.querySelector('circle');
    if (circle) {
      const cx = nextBox.left + ((snapshot.cx ?? 0) - startBox.left) * scaleX;
      const cy = nextBox.top + ((snapshot.cy ?? 0) - startBox.top) * scaleY;
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(Math.max((snapshot.radius ?? toNumber(circle.getAttribute('r'))) * ((scaleX + scaleY) / 2), 1)));
    }

    const texts = snapshot.node.querySelectorAll('text');
    const indexText = texts[0] ?? null;
    const label = texts[1] ?? null;
    if (indexText) {
      indexText.setAttribute('x', String(nextBox.left + ((snapshot.indexX ?? 0) - startBox.left) * scaleX));
      indexText.setAttribute('y', String(nextBox.top + ((snapshot.indexY ?? 0) - startBox.top) * scaleY));
    }
    if (label) {
      label.setAttribute('x', String(nextBox.left + ((snapshot.labelX ?? 0) - startBox.left) * scaleX));
      label.setAttribute('y', String(nextBox.top + ((snapshot.labelY ?? 0) - startBox.top) * scaleY));
    }
  }

  function applyMoveSnapshot(snapshot: MoveShapeSnapshot, deltaX: number, deltaY: number) {
    if (snapshot.type === 'pen') {
      const movedPoints = (snapshot.pathPoints ?? []).map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
      snapshot.node.setAttribute('d', buildPath(movedPoints));
      return;
    }

    if (snapshot.type === 'rect') {
      snapshot.node.setAttribute('x', String((snapshot.x ?? 0) + deltaX));
      snapshot.node.setAttribute('y', String((snapshot.y ?? 0) + deltaY));
      return;
    }

    if (snapshot.type === 'ellipse') {
      snapshot.node.setAttribute('cx', String((snapshot.cx ?? 0) + deltaX));
      snapshot.node.setAttribute('cy', String((snapshot.cy ?? 0) + deltaY));
      return;
    }

    if (snapshot.type === 'arrow') {
      snapshot.node.setAttribute('x1', String((snapshot.x1 ?? 0) + deltaX));
      snapshot.node.setAttribute('y1', String((snapshot.y1 ?? 0) + deltaY));
      snapshot.node.setAttribute('x2', String((snapshot.x2 ?? 0) + deltaX));
      snapshot.node.setAttribute('y2', String((snapshot.y2 ?? 0) + deltaY));
      return;
    }

    if (snapshot.type === 'text') {
      snapshot.node.setAttribute('x', String((snapshot.x ?? 0) + deltaX));
      snapshot.node.setAttribute('y', String((snapshot.y ?? 0) + deltaY));
      return;
    }

    const circle = snapshot.node.querySelector('circle');
    if (circle) {
      circle.setAttribute('cx', String((snapshot.cx ?? 0) + deltaX));
      circle.setAttribute('cy', String((snapshot.cy ?? 0) + deltaY));
    }

    const texts = snapshot.node.querySelectorAll('text');
    const indexText = texts[0] ?? null;
    const label = texts[1] ?? null;
    if (indexText) {
      indexText.setAttribute('x', String((snapshot.indexX ?? 0) + deltaX));
      indexText.setAttribute('y', String((snapshot.indexY ?? 0) + deltaY));
    }
    if (label) {
      label.setAttribute('x', String((snapshot.labelX ?? 0) + deltaX));
      label.setAttribute('y', String((snapshot.labelY ?? 0) + deltaY));
    }
  }

  function findShapeAtPoint(point: Point): ShapeModel | null {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const shape = shapes[index];
      const id = nodeToShapeId.get(shape);
      if (!id) continue;
      const model = shapesById.get(id);
      if (!model) continue;
      if (containsPoint(model, point)) {
        return model;
      }
    }
    return null;
  }

  function containsPoint(shape: ShapeModel, point: Point) {
    if (shape.type === 'pen') {
      const points = parsePathPoints(shape.node.getAttribute('d'));
      if (points.length < 2) {
        return false;
      }
      for (let index = 0; index < points.length - 1; index += 1) {
        if (distanceToSegment(point, points[index], points[index + 1]) <= 6) {
          return true;
        }
      }
      return false;
    }

    if (shape.type === 'rect') {
      const x = toNumber(shape.node.getAttribute('x'));
      const y = toNumber(shape.node.getAttribute('y'));
      const width = toNumber(shape.node.getAttribute('width'));
      const height = toNumber(shape.node.getAttribute('height'));
      return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
    }

    if (shape.type === 'ellipse') {
      const cx = toNumber(shape.node.getAttribute('cx'));
      const cy = toNumber(shape.node.getAttribute('cy'));
      const rx = Math.max(toNumber(shape.node.getAttribute('rx')), 0.01);
      const ry = Math.max(toNumber(shape.node.getAttribute('ry')), 0.01);
      const normalized = (((point.x - cx) * (point.x - cx)) / (rx * rx)) + (((point.y - cy) * (point.y - cy)) / (ry * ry));
      return normalized <= 1;
    }

    if (shape.type === 'arrow') {
      const x1 = toNumber(shape.node.getAttribute('x1'));
      const y1 = toNumber(shape.node.getAttribute('y1'));
      const x2 = toNumber(shape.node.getAttribute('x2'));
      const y2 = toNumber(shape.node.getAttribute('y2'));
      return distanceToSegment(point, { x: x1, y: y1 }, { x: x2, y: y2 }) <= 6;
    }

    if (shape.type === 'text') {
      const x = toNumber(shape.node.getAttribute('x'));
      const y = toNumber(shape.node.getAttribute('y'));
      const textLength = Math.max((shape.node.textContent ?? '').length, 1);
      return point.x >= x && point.x <= x + textLength * 10 && point.y >= y - 18 && point.y <= y + 2;
    }

    if (shape.type === 'callout') {
      const circle = shape.node.querySelector('circle');
      if (circle) {
        const cx = toNumber(circle.getAttribute('cx'));
        const cy = toNumber(circle.getAttribute('cy'));
        const radius = toNumber(circle.getAttribute('r'));
        const dx = point.x - cx;
        const dy = point.y - cy;
        if ((dx * dx) + (dy * dy) <= radius * radius) {
          return true;
        }
      }

      const label = shape.node.querySelectorAll('text')[1];
      if (label) {
        const lx = toNumber(label.getAttribute('x'));
        const ly = toNumber(label.getAttribute('y'));
        const labelLength = Math.max((label.textContent ?? '').length, 1);
        return point.x >= lx && point.x <= lx + labelLength * 10 && point.y >= ly - 18 && point.y <= ly + 2;
      }
    }

    return false;
  }

  function toggleSelection(id: string) {
    if (selection.has(id)) {
      selection.delete(id);
    } else {
      selection.add(id);
    }
    renderSelectionState();
  }

  function setSelection(ids: Iterable<string>) {
    selection.clear();
    for (const id of ids) {
      if (shapesById.has(id)) {
        selection.add(id);
      }
    }
    renderSelectionState();
  }

  function renderSelectionState() {
    for (const [id, shape] of shapesById) {
      shape.node.toggleAttribute('data-selected', selection.has(id));
    }
    renderSelectionHandles();
    options.onSelectionChange?.(selection.size > 0);
  }

  function clearSelectionUi() {
    for (const node of selectionUiNodes) {
      node.remove();
    }
    selectionUiNodes = [];
  }

  function renderSelectionHandles() {
    clearSelectionUi();
    if (tool !== 'select' || selection.size === 0) {
      return;
    }

    const selectedShapes = Array.from(selection)
      .map((id) => shapesById.get(id))
      .filter((shape): shape is ShapeModel => Boolean(shape));

    if (selectedShapes.length === 1 && selectedShapes[0].type === 'arrow' && isSvgTag(selectedShapes[0].node, 'line')) {
      const line = selectedShapes[0].node;
      const handles: Array<{ endpoint: 'start' | 'end'; x: number; y: number }> = [
        { endpoint: 'start', x: toNumber(line.getAttribute('x1')), y: toNumber(line.getAttribute('y1')) },
        { endpoint: 'end', x: toNumber(line.getAttribute('x2')), y: toNumber(line.getAttribute('y2')) },
      ];

      for (const handle of handles) {
        const node = document.createElementNS(SVG_NS, 'circle');
        node.setAttribute('cx', String(handle.x));
        node.setAttribute('cy', String(handle.y));
        node.setAttribute('r', '6');
        node.setAttribute('fill', '#ffffff');
        node.setAttribute('stroke', '#0f172a');
        node.setAttribute('stroke-width', '1.5');
        node.dataset.arrowEndpoint = handle.endpoint;
        node.dataset.shapeId = selectedShapes[0].id;
        node.style.cursor = 'move';
        svg.appendChild(node);
        selectionUiNodes.push(node);
      }
      return;
    }

    const bounds = getSelectionBounds();
    if (!bounds) {
      return;
    }

    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.setAttribute('x', String(bounds.left));
    frame.setAttribute('y', String(bounds.top));
    frame.setAttribute('width', String(bounds.right - bounds.left));
    frame.setAttribute('height', String(bounds.bottom - bounds.top));
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', '#0f172a');
    frame.setAttribute('stroke-width', '1');
    frame.setAttribute('stroke-dasharray', '4 2');
    frame.style.pointerEvents = 'none';
    svg.appendChild(frame);
    selectionUiNodes.push(frame);

    const corners: Record<ResizeHandle, Point> = {
      nw: { x: bounds.left, y: bounds.top },
      ne: { x: bounds.right, y: bounds.top },
      sw: { x: bounds.left, y: bounds.bottom },
      se: { x: bounds.right, y: bounds.bottom },
    };

    for (const handle of Object.keys(corners) as ResizeHandle[]) {
      const corner = corners[handle];
      const node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('cx', String(corner.x));
      node.setAttribute('cy', String(corner.y));
      node.setAttribute('r', '5');
      node.setAttribute('fill', '#ffffff');
      node.setAttribute('stroke', '#0f172a');
      node.setAttribute('stroke-width', '1.5');
      node.dataset.resizeHandle = handle;
      node.style.cursor = `${handle}-resize`;
      svg.appendChild(node);
      selectionUiNodes.push(node);
    }
  }

  function getSelectionBounds(): Bounds | null {
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const id of selection) {
      const shape = shapesById.get(id);
      if (!shape) continue;
      const bounds = getShapeBounds(shape);
      left = Math.min(left, bounds.left);
      top = Math.min(top, bounds.top);
      right = Math.max(right, bounds.right);
      bottom = Math.max(bottom, bounds.bottom);
    }

    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
      return null;
    }

    return { left, top, right, bottom };
  }

  function getShapeBounds(shape: ShapeModel): Bounds {
    if (shape.type === 'pen') {
      const points = parsePathPoints(shape.node.getAttribute('d'));
      if (points.length === 0) {
        return { left: 0, top: 0, right: 0, bottom: 0 };
      }
      let left = points[0].x;
      let top = points[0].y;
      let right = points[0].x;
      let bottom = points[0].y;
      for (const point of points) {
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
      return { left, top, right, bottom };
    }

    if (shape.type === 'rect') {
      const x = toNumber(shape.node.getAttribute('x'));
      const y = toNumber(shape.node.getAttribute('y'));
      const width = toNumber(shape.node.getAttribute('width'));
      const height = toNumber(shape.node.getAttribute('height'));
      return { left: x, top: y, right: x + width, bottom: y + height };
    }

    if (shape.type === 'ellipse') {
      const cx = toNumber(shape.node.getAttribute('cx'));
      const cy = toNumber(shape.node.getAttribute('cy'));
      const rx = toNumber(shape.node.getAttribute('rx'));
      const ry = toNumber(shape.node.getAttribute('ry'));
      return { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry };
    }

    if (shape.type === 'arrow') {
      const x1 = toNumber(shape.node.getAttribute('x1'));
      const y1 = toNumber(shape.node.getAttribute('y1'));
      const x2 = toNumber(shape.node.getAttribute('x2'));
      const y2 = toNumber(shape.node.getAttribute('y2'));
      return {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2),
      };
    }

    if (shape.type === 'text') {
      const x = toNumber(shape.node.getAttribute('x'));
      const y = toNumber(shape.node.getAttribute('y'));
      const textLength = Math.max((shape.node.textContent ?? '').length, 1);
      return { left: x, top: y - 18, right: x + textLength * 10, bottom: y + 2 };
    }

    const circle = shape.node.querySelector('circle');
    const texts = shape.node.querySelectorAll('text');
    const label = texts[1] ?? null;
    const cx = toNumber(circle?.getAttribute('cx') ?? null);
    const cy = toNumber(circle?.getAttribute('cy') ?? null);
    const r = toNumber(circle?.getAttribute('r') ?? null);
    let left = cx - r;
    let top = cy - r;
    let right = cx + r;
    let bottom = cy + r;
    if (label) {
      const lx = toNumber(label.getAttribute('x'));
      const ly = toNumber(label.getAttribute('y'));
      const labelLength = Math.max((label.textContent ?? '').length, 1);
      left = Math.min(left, lx);
      top = Math.min(top, ly - 18);
      right = Math.max(right, lx + labelLength * 10);
      bottom = Math.max(bottom, ly + 2);
    }
    return { left, top, right, bottom };
  }

  function getResizeAnchor(bounds: Bounds, handle: ResizeHandle): Point {
    if (handle === 'nw') return { x: bounds.right, y: bounds.bottom };
    if (handle === 'ne') return { x: bounds.left, y: bounds.bottom };
    if (handle === 'sw') return { x: bounds.right, y: bounds.top };
    return { x: bounds.left, y: bounds.top };
  }

  function getResizedBounds(session: ResizeSession, pointer: Point, lockAspectRatio: boolean): Bounds {
    const startWidth = Math.max(session.startBox.right - session.startBox.left, 0.01);
    const startHeight = Math.max(session.startBox.bottom - session.startBox.top, 0.01);
    let nextX = pointer.x;
    let nextY = pointer.y;

    if (lockAspectRatio) {
      const deltaX = pointer.x - session.anchor.x;
      const deltaY = pointer.y - session.anchor.y;
      const signX = deltaX === 0 ? (session.handle === 'nw' || session.handle === 'sw' ? -1 : 1) : Math.sign(deltaX);
      const signY = deltaY === 0 ? (session.handle === 'nw' || session.handle === 'ne' ? -1 : 1) : Math.sign(deltaY);
      const uniformScale = Math.max(Math.abs(deltaX) / startWidth, Math.abs(deltaY) / startHeight, 0.01);
      nextX = session.anchor.x + signX * startWidth * uniformScale;
      nextY = session.anchor.y + signY * startHeight * uniformScale;
    }

    return {
      left: Math.min(session.anchor.x, nextX),
      top: Math.min(session.anchor.y, nextY),
      right: Math.max(session.anchor.x, nextX),
      bottom: Math.max(session.anchor.y, nextY),
    };
  }

  function svgPointToCss(point: Point): Point {
    const pt = svg.createSVGPoint();
    pt.x = point.x;
    pt.y = point.y;
    const screenPt = pt.matrixTransform(svg.getScreenCTM()!);
    const hostRect = host.getBoundingClientRect();
    return { x: screenPt.x - hostRect.left, y: screenPt.y - hostRect.top };
  }

  function showEditor(point: Point, onCommit: (value: string) => void) {
    log(`showEditor at SVG point ${point.x.toFixed(1)},${point.y.toFixed(1)}`);
    removeEditor();

    let cssPoint: Point;
    try {
      cssPoint = svgPointToCss(point);
      log(`showEditor cssPoint: ${cssPoint.x.toFixed(1)},${cssPoint.y.toFixed(1)}`);
    } catch (err) {
      log(`showEditor svgPointToCss FAILED: ${err}`);
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type and press Enter';
    input.style.position = 'absolute';
    input.style.left = `${cssPoint.x}px`;
    input.style.top = `${cssPoint.y}px`;
    input.style.zIndex = '3';
    input.style.minWidth = '160px';
    input.style.height = '28px';
    input.style.padding = '0 8px';
    input.style.border = '1px solid var(--vscode-input-border, #3c3c3c)';
    input.style.borderRadius = '4px';
    input.style.background = 'var(--vscode-input-background, #3c3c3c)';
    input.style.color = 'var(--vscode-input-foreground, #cccccc)';
    input.style.fontFamily = 'var(--vscode-font-family, system-ui, sans-serif)';
    input.style.fontSize = '13px';
    input.style.outline = 'none';
    host.appendChild(input);
    editor = input;
    log(`showEditor: input appended to host, children=${host.children.length}`);
    const rect = input.getBoundingClientRect();
    log(`showEditor: input rect x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`);

    let finished = false;
    const finish = (commit: boolean) => {
      log(`showEditor finish commit=${commit} finished=${finished} value=${JSON.stringify(input.value)}`);
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      removeEditor();
      if (commit && value) {
        onCommit(value);
      }
    };

    input.addEventListener('keydown', (event) => {
      // Always stop propagation so the document-level annotation shortcuts
      // (tool keys, color digits, Delete/Backspace, Ctrl+Z, etc.) never fire
      // while the user is typing in the inline editor.
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });

    // Defer focus + blur listener to next frame so the mousedown event's
    // native focus mechanics settle before we hand focus to the input.
    requestAnimationFrame(() => {
      if (finished) return;
      input.focus();
      log(`showEditor: focus() called, activeElement===input: ${document.activeElement === input}`);
      input.addEventListener('blur', () => {
        log('showEditor: input blur event');
        finish(true);
      }, { once: true });
    });
  }

  function removeEditor() {
    log(`removeEditor called, editor exists=${!!editor}`);
    if (!editor) return;
    editor.remove();
    editor = null;
  }

  function snapshotIds(snapshots: MoveShapeSnapshot[]) {
    return new Set(snapshots.map((snapshot) => snapshot.id));
  }

  function sameGeometry(left: MoveShapeSnapshot, right: MoveShapeSnapshot) {
    if (left.id !== right.id || left.type !== right.type) {
      return false;
    }

    if (left.type === 'pen') {
      const leftPoints = left.pathPoints ?? [];
      const rightPoints = right.pathPoints ?? [];
      if (leftPoints.length !== rightPoints.length) {
        return false;
      }
      return leftPoints.every((point, index) => point.x === rightPoints[index]?.x && point.y === rightPoints[index]?.y);
    }

    if (left.type === 'rect') {
      return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
    }

    if (left.type === 'ellipse') {
      return left.cx === right.cx && left.cy === right.cy && left.rx === right.rx && left.ry === right.ry;
    }

    if (left.type === 'arrow') {
      return left.x1 === right.x1 && left.y1 === right.y1 && left.x2 === right.x2 && left.y2 === right.y2;
    }

    if (left.type === 'text') {
      return left.x === right.x && left.y === right.y;
    }

    return (
      left.cx === right.cx
      && left.cy === right.cy
      && left.radius === right.radius
      && left.indexX === right.indexX
      && left.indexY === right.indexY
      && left.labelX === right.labelX
      && left.labelY === right.labelY
    );
  }

  function applySnapshot(snapshot: MoveShapeSnapshot) {
    const node = snapshot.node;

    if (snapshot.type === 'pen') {
      node.setAttribute('d', buildPath(snapshot.pathPoints ?? []));
      return;
    }

    if (snapshot.type === 'rect') {
      node.setAttribute('x', String(snapshot.x ?? 0));
      node.setAttribute('y', String(snapshot.y ?? 0));
      node.setAttribute('width', String(snapshot.width ?? 0));
      node.setAttribute('height', String(snapshot.height ?? 0));
      return;
    }

    if (snapshot.type === 'ellipse') {
      node.setAttribute('cx', String(snapshot.cx ?? 0));
      node.setAttribute('cy', String(snapshot.cy ?? 0));
      node.setAttribute('rx', String(snapshot.rx ?? 0));
      node.setAttribute('ry', String(snapshot.ry ?? 0));
      return;
    }

    if (snapshot.type === 'arrow') {
      node.setAttribute('x1', String(snapshot.x1 ?? 0));
      node.setAttribute('y1', String(snapshot.y1 ?? 0));
      node.setAttribute('x2', String(snapshot.x2 ?? 0));
      node.setAttribute('y2', String(snapshot.y2 ?? 0));
      return;
    }

    if (snapshot.type === 'text') {
      node.setAttribute('x', String(snapshot.x ?? 0));
      node.setAttribute('y', String(snapshot.y ?? 0));
      return;
    }

    const circle = node.querySelector('circle');
    if (circle) {
      circle.setAttribute('cx', String(snapshot.cx ?? 0));
      circle.setAttribute('cy', String(snapshot.cy ?? 0));
      circle.setAttribute('r', String(snapshot.radius ?? 14));
    }

    const texts = node.querySelectorAll('text');
    const indexText = texts[0] ?? null;
    const label = texts[1] ?? null;
    if (indexText) {
      indexText.setAttribute('x', String(snapshot.indexX ?? 0));
      indexText.setAttribute('y', String(snapshot.indexY ?? 0));
    }
    if (label) {
      label.setAttribute('x', String(snapshot.labelX ?? 0));
      label.setAttribute('y', String(snapshot.labelY ?? 0));
    }
  }

  function insertShapeAt(snapshot: MoveShapeSnapshot) {
    const existingIndex = shapes.indexOf(snapshot.node);
    if (existingIndex >= 0) {
      shapes.splice(existingIndex, 1);
    }

    const nextIndex = Math.min(Math.max(snapshot.index, 0), shapes.length);
    const referenceNode = shapes[nextIndex] ?? null;
    if (referenceNode) {
      svg.insertBefore(snapshot.node, referenceNode);
    } else {
      svg.appendChild(snapshot.node);
    }
    shapes.splice(nextIndex, 0, snapshot.node);

    const type = getShapeType(snapshot.node);
    snapshot.node.dataset.annotationType = type;
    snapshot.node.dataset.annotationId = snapshot.id;
    nodeToShapeId.set(snapshot.node, snapshot.id);
    shapesById.set(snapshot.id, { id: snapshot.id, type, node: snapshot.node });
    applySnapshot(snapshot);
    syncCalloutCounter();
  }

  function removeShapeById(id: string) {
    const shape = getShapeById(id);
    if (!shape) {
      return;
    }

    shape.node.remove();
    shapes = shapes.filter((node) => node !== shape.node);
    shapesById.delete(id);
    selection.delete(id);
    syncCalloutCounter();
  }

  function syncCalloutCounter() {
    let maxIndex = 0;
    for (const shape of shapesById.values()) {
      if (shape.type !== 'callout') {
        continue;
      }
      const indexText = shape.node.querySelectorAll('text')[0];
      const parsed = Number.parseInt(indexText?.textContent ?? '', 10);
      if (Number.isFinite(parsed)) {
        maxIndex = Math.max(maxIndex, parsed);
      }
    }
    calloutCounter = maxIndex + 1;
  }

  function restoreSnapshots(snapshots: MoveShapeSnapshot[]) {
    const ordered = [...snapshots].sort((left, right) => left.index - right.index);
    for (const snapshot of ordered) {
      insertShapeAt(snapshot);
    }
  }

  function removeSnapshots(snapshots: MoveShapeSnapshot[]) {
    for (const id of snapshotIds(snapshots)) {
      removeShapeById(id);
    }
  }

  function applyHistoryEntry(entry: HistoryEntry, direction: 'undo' | 'redo') {
    if (entry.kind === 'create') {
      if (direction === 'undo') {
        removeSnapshots(entry.snapshots);
      } else {
        restoreSnapshots(entry.snapshots);
      }
      return;
    }

    if (entry.kind === 'delete') {
      if (direction === 'undo') {
        restoreSnapshots(entry.snapshots);
      } else {
        removeSnapshots(entry.snapshots);
      }
      return;
    }

    const snapshots = direction === 'undo' ? entry.before : entry.after;
    for (const snapshot of snapshots) {
      applySnapshot(snapshot);
    }
  }

  return {
    setActive(nextActive) {
      log(`setActive ${nextActive} (was ${active}) pointerEvents=${nextActive ? 'auto' : 'none'}`);
      active = nextActive;
      if (!active) {
        cancelDraft();
        removeEditor();
        moveSession = null;
        resizeSession = null;
        arrowEndpointSession = null;
        setSelection([]);
      }
      svg.style.pointerEvents = active ? 'auto' : 'none';
      iframe.style.pointerEvents = active ? 'none' : 'auto';
    },

    setTool(nextTool) {
      log(`setTool ${nextTool} (was ${tool})`);
      if (tool !== nextTool) {
        cancelDraft();
      }
      tool = nextTool;
      if (tool !== 'select') {
        moveSession = null;
        resizeSession = null;
        arrowEndpointSession = null;
        origin = null;
        setSelection([]);
      }
    },

    setColor(nextColor) {
      color = nextColor;
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      applyHistoryEntry(entry, 'undo');
      redoStack.push(entry);
      renderSelectionState();
    },

    redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      applyHistoryEntry(entry, 'redo');
      undoStack.push(entry);
      renderSelectionState();
    },

    deleteSelection() {
      if (selection.size === 0) {
        return false;
      }

      const snapshots = Array.from(selection)
        .map((id) => getShapeById(id))
        .filter((shape): shape is ShapeModel => Boolean(shape))
        .map((shape) => toMoveSnapshot(shape));

      if (snapshots.length === 0) {
        return false;
      }

      removeSnapshots(snapshots);
      pushHistory({ kind: 'delete', snapshots });
      setSelection([]);
      return true;
    },

    clear() {
      const snapshots = shapes
        .map((shape) => {
          const id = nodeToShapeId.get(shape);
          return id ? getShapeById(id) : null;
        })
        .filter((shape): shape is ShapeModel => Boolean(shape))
        .map((shape) => toMoveSnapshot(shape));

      const hadShapes = snapshots.length > 0;
      if (hadShapes) {
        removeSnapshots(snapshots);
        pushHistory({ kind: 'delete', snapshots });
      }

      selection.clear();
      clearSelectionUi();
      calloutCounter = 1;
      removeEditor();
      cancelDraft();
      renderSelectionState();
      return hadShapes;
    },

    hasShapes() {
      return shapes.length > 0;
    },

    async composite(screenshotDataUrl) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(iframe.clientWidth, 1);
      canvas.height = Math.max(iframe.clientHeight, 1);
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Could not create canvas context');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      if (screenshotDataUrl) {
        context.drawImage(await loadImage(screenshotDataUrl), 0, 0, canvas.width, canvas.height);
      }

      const hadSelectionUi = selectionUiNodes.length > 0;
      if (hadSelectionUi) {
        clearSelectionUi();
      }

      const serializedSvg = new XMLSerializer().serializeToString(svg);
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`;
      context.drawImage(await loadImage(svgDataUrl), 0, 0, canvas.width, canvas.height);

      if (hadSelectionUi) {
        renderSelectionHandles();
      }

      return canvas.toDataURL('image/png');
    },

    destroy() {
      resizeObserver.disconnect();
      svg.removeEventListener('mousedown', handleMouseDown);
      svg.removeEventListener('mousemove', handleMouseMove);
      svg.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      cancelDraft();
      removeEditor();
      iframeEl.style.pointerEvents = 'auto';
      svg.remove();
    },
  };

  function createDraftShape(currentTool: ShapeType, point: Point) {
    if (currentTool === 'arrow') {
      const markerId = ensureArrowMarker(color);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(point.x));
      line.setAttribute('y1', String(point.y));
      line.setAttribute('x2', String(point.x));
      line.setAttribute('y2', String(point.y));
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', `url(#${markerId})`);
      return line;
    }

    if (currentTool === 'rect') {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(point.x));
      rect.setAttribute('y', String(point.y));
      rect.setAttribute('width', '0');
      rect.setAttribute('height', '0');
      rect.setAttribute('stroke', color);
      rect.setAttribute('stroke-width', '2');
      rect.setAttribute('fill', color);
      rect.setAttribute('fill-opacity', '0.12');
      return rect;
    }

    if (currentTool === 'ellipse') {
      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      ellipse.setAttribute('cx', String(point.x));
      ellipse.setAttribute('cy', String(point.y));
      ellipse.setAttribute('rx', '0');
      ellipse.setAttribute('ry', '0');
      ellipse.setAttribute('stroke', color);
      ellipse.setAttribute('stroke-width', '2');
      ellipse.setAttribute('fill', color);
      ellipse.setAttribute('fill-opacity', '0.12');
      return ellipse;
    }

    return null;
  }

  function inferShapeType(shape: SVGElement): ShapeType {
    if (isSvgTag(shape, 'path')) return 'pen';
    if (isSvgTag(shape, 'line')) return 'arrow';
    if (isSvgTag(shape, 'rect')) return 'rect';
    if (isSvgTag(shape, 'ellipse')) return 'ellipse';
    if (isSvgTag(shape, 'text')) return 'text';
    return 'callout';
  }

  function updateDraftShape(shape: SVGElement, start: Point, end: Point) {
    if (isSvgTag(shape, 'line')) {
      shape.setAttribute('x2', String(end.x));
      shape.setAttribute('y2', String(end.y));
      return;
    }

    if (isSvgTag(shape, 'rect')) {
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      shape.setAttribute('x', String(left));
      shape.setAttribute('y', String(top));
      shape.setAttribute('width', String(Math.abs(end.x - start.x)));
      shape.setAttribute('height', String(Math.abs(end.y - start.y)));
      return;
    }

    if (isSvgTag(shape, 'ellipse')) {
      shape.setAttribute('cx', String((start.x + end.x) / 2));
      shape.setAttribute('cy', String((start.y + end.y) / 2));
      shape.setAttribute('rx', String(Math.abs(end.x - start.x) / 2));
      shape.setAttribute('ry', String(Math.abs(end.y - start.y) / 2));
    }
  }

  function ensureArrowMarker(markerColor: string) {
    const markerId = `annotation-overlay-arrow-${normalizeColorForId(markerColor)}`;
    if (defs.querySelector(`#${markerId}`)) {
      return markerId;
    }

    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'strokeWidth');

    const arrowHead = document.createElementNS(SVG_NS, 'path');
    arrowHead.setAttribute('d', 'M 0 0 L 8 3 L 0 6 z');
    arrowHead.setAttribute('fill', markerColor);
    marker.appendChild(arrowHead);
    defs.appendChild(marker);

    return markerId;
  }

  function cancelDraft() {
    draft?.remove();
    draft = null;
    origin = null;
    penPoints = [];
    moveSession = null;
    resizeSession = null;
    arrowEndpointSession = null;
  }
}

function getPoint(event: MouseEvent, svg: SVGSVGElement): Point {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

function toNumber(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function distanceToSegment(point: Point, start: Point, end: Point) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (deltaX === 0 && deltaY === 0) {
    const startDx = point.x - start.x;
    const startDy = point.y - start.y;
    return Math.hypot(startDx, startDy);
  }

  const t = Math.max(0, Math.min(1, (((point.x - start.x) * deltaX) + ((point.y - start.y) * deltaY)) / ((deltaX * deltaX) + (deltaY * deltaY))));
  const projectedX = start.x + t * deltaX;
  const projectedY = start.y + t * deltaY;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

function buildPath(points: Point[]) {
  if (points.length === 0) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
}

function parsePathPoints(pathData: string | null): Point[] {
  if (!pathData) {
    return [];
  }

  const matches = Array.from(pathData.matchAll(/[ML]\s*([\-\d.]+)\s+([\-\d.]+)/g));
  return matches.map((match) => ({
    x: toNumber(match[1] ?? null),
    y: toNumber(match[2] ?? null),
  }));
}

function isSvgTag(element: Element | null, tagName: string) {
  return element?.tagName.toLowerCase() === tagName;
}

function normalizeColorForId(color: string) {
  return color.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function loadImage(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 32)}`));
    image.src = src;
  });
}
