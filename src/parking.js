'use strict';

// Geometry for parking windows under the edge dock. Pure functions so multi-
// display layouts can be tested without a screen.
//
// A parked window keeps OVERLAP points on its own display and hangs the rest
// off an edge that has no display beyond it. That keeps the window on the
// display it started on (same scale factor, same OBS crop) while nothing of
// it is visible except a sliver hidden under a thin cover strip.

const STRIP = 36; // width of the collapsed dock pill
const OVERLAP = 6; // points of a parked window left on screen

const OPPOSITE = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };

function overlapsVertically(a, b) {
  return a.y < b.y + b.height && a.y + a.height > b.y;
}

function overlapsHorizontally(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

// Which edges of `display` have no other display beyond them.
function freeEdges(display, displays) {
  const b = display.bounds;
  const others = displays.filter((d) => d.id !== display.id).map((d) => d.bounds);
  return {
    right: !others.some((o) => o.x >= b.x + b.width && overlapsVertically(o, b)),
    left: !others.some((o) => o.x + o.width <= b.x && overlapsVertically(o, b)),
    bottom: !others.some((o) => o.y >= b.y + b.height && overlapsHorizontally(o, b)),
    top: !others.some((o) => o.y + o.height <= b.y && overlapsHorizontally(o, b)),
  };
}

// The edge a display parks toward: the dock side if free, else the opposite
// side, then bottom, then top. Falls back to the dock side when boxed in.
function parkingEdge(display, displays, side) {
  const free = freeEdges(display, displays);
  const order = [side, OPPOSITE[side], 'bottom', 'top'];
  return order.find((edge) => free[edge]) || side;
}

// Position of a parked window of content size [w, h] currently at (x, y),
// leaving `overlap` points on screen.
function parkedPosition(edge, area, x, y, w, h, overlap = OVERLAP) {
  switch (edge) {
    case 'left':
      return { x: area.x - w + overlap, y };
    case 'bottom':
      return { x, y: area.y + area.height - overlap };
    case 'top':
      return { x, y: area.y - h + overlap };
    case 'right':
    default:
      return { x: area.x + area.width - overlap, y };
  }
}

// Bounds of a strip along `edge` of a work area; `width` is the strip's
// thickness (OVERLAP for cover strips).
function stripBounds(edge, area, width = OVERLAP) {
  switch (edge) {
    case 'left':
      return { x: area.x, y: area.y, width, height: area.height };
    case 'bottom':
      return { x: area.x, y: area.y + area.height - width, width: area.width, height: width };
    case 'top':
      return { x: area.x, y: area.y, width: area.width, height: width };
    case 'right':
    default:
      return { x: area.x + area.width - width, y: area.y, width, height: area.height };
  }
}

// Bounds of the dock pill: `size` is { width, height }, centred along `side`.
function pillBounds(side, area, size) {
  const height = Math.min(size.height, area.height);
  const y = Math.round(area.y + (area.height - height) / 2);
  const x = side === 'left' ? area.x : area.x + area.width - size.width;
  return { x, y, width: size.width, height };
}

module.exports = { STRIP, OVERLAP, freeEdges, parkingEdge, parkedPosition, stripBounds, pillBounds };
