export type AnnotationTool = 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'callout';

export interface AnnotationOverlay {
  setActive(active: boolean): void;
  setTool(tool: AnnotationTool): void;
  setColor(color: string): void;
  undo(): void;
  redo(): void;
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

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createAnnotationOverlay(iframe = document.getElementById('browser-iframe')): AnnotationOverlay {
  if (!(iframe instanceof HTMLIFrameElement) || !iframe.parentElement) {
    throw new Error('Expected #browser-iframe inside a parent element');
  }

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

  let active = false;
  let tool: AnnotationTool = 'pen';
  let color = '#ff3b30';
  let draft: DraftShape = null;
  let origin: Point | null = null;
  let penPoints: Point[] = [];
  let shapes: SVGElement[] = [];
  let redoStack: SVGElement[] = [];
  let editor: HTMLInputElement | null = null;
  let calloutCounter = 1;

  const handleMouseDown = (event: MouseEvent) => {
    if (!active || editor || event.button !== 0) return;

    const point = getPoint(event, svg);
    origin = point;

    if (tool === 'text') {
      showEditor(point, (value) => {
        if (!value) return;
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(point.x));
        text.setAttribute('y', String(point.y));
        text.setAttribute('fill', color);
        text.setAttribute('font-size', '16');
        text.textContent = value;
        commitShape(text);
      });
      origin = null;
      return;
    }

    if (tool === 'callout') {
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
        commitShape(group);
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

    draft = createDraftShape(tool, point);
    if (draft) {
      svg.appendChild(draft);
    }
  };

  const handleMouseMove = (event: MouseEvent) => {
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
    if (!origin || !draft) {
      origin = null;
      draft = null;
      return;
    }

    const point = getPoint(event, svg);

    if (tool !== 'pen') {
      updateDraftShape(draft, origin, point);
    }

    commitShape(draft);
    draft = null;
    origin = null;
    penPoints = [];
  };

  const handleWindowMouseUp = (event: MouseEvent) => {
    if (!origin || !draft) return;
    handleMouseUp(event);
  };

  svg.addEventListener('mousedown', handleMouseDown);
  svg.addEventListener('mousemove', handleMouseMove);
  svg.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mouseup', handleWindowMouseUp);

  function commitShape(shape: SVGElement) {
    if (!shape.parentNode) {
      svg.appendChild(shape);
    }
    shapes.push(shape);
    redoStack = [];
  }

  function showEditor(point: Point, onCommit: (value: string) => void) {
    removeEditor();

    const input = document.createElement('input');
    input.type = 'text';
    input.style.position = 'absolute';
    input.style.left = `${point.x}px`;
    input.style.top = `${point.y}px`;
    input.style.zIndex = '3';
    host.appendChild(input);
    editor = input;

    const finish = (commit: boolean) => {
      const value = input.value.trim();
      removeEditor();
      if (commit && value) {
        onCommit(value);
      }
    };

    input.addEventListener('blur', () => finish(true), { once: true });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });

    input.focus();
  }

  function removeEditor() {
    if (!editor) return;
    editor.remove();
    editor = null;
  }

  return {
    setActive(nextActive) {
      active = nextActive;
      if (!active) {
        cancelDraft();
        removeEditor();
      }
      svg.style.pointerEvents = active ? 'auto' : 'none';
      iframe.style.pointerEvents = active ? 'none' : 'auto';
    },

    setTool(nextTool) {
      tool = nextTool;
    },

    setColor(nextColor) {
      color = nextColor;
    },

    undo() {
      const shape = shapes.pop();
      if (!shape) return;
      shape.remove();
      redoStack.push(shape);
    },

    redo() {
      const shape = redoStack.pop();
      if (!shape) return;
      svg.appendChild(shape);
      shapes.push(shape);
    },

    clear() {
      const hadShapes = shapes.length > 0;
      for (const shape of shapes) {
        shape.remove();
      }
      shapes = [];
      redoStack = [];
      calloutCounter = 1;
      defs.replaceChildren();
      removeEditor();
      cancelDraft();
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

      const serializedSvg = new XMLSerializer().serializeToString(svg);
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializedSvg)}`;
      context.drawImage(await loadImage(svgDataUrl), 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/png');
    },

    destroy() {
      svg.removeEventListener('mousedown', handleMouseDown);
      svg.removeEventListener('mousemove', handleMouseMove);
      svg.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      cancelDraft();
      removeEditor();
      iframe.style.pointerEvents = 'auto';
      svg.remove();
    },
  };

  function createDraftShape(currentTool: AnnotationTool, point: Point) {
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
  }
}

function getPoint(event: MouseEvent, svg: SVGSVGElement): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function buildPath(points: Point[]) {
  if (points.length === 0) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
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
