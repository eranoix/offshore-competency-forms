/**
 * Finds the writing box on the drawn page: a filled document's box grows past the blank template's
 * measurement, so it is read from the page's stroked rectangles instead.
 */
/**
 * Every bordered box on one drawn page, as fractions of it; its height comes from the drawing.
 */
export async function boxesDrawn(pdfjs, page, size) {
  const { OPS } = pdfjs;
  let list;
  try {
    list = await page.getOperatorList();
  } catch {
    return [];
  }
  /* The transform in force, and the stack the save/restore pairs make of it. */
  let now = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const times = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /* The layout engine draws each box edge as its own stroke and the uprights one text line at a time,
     so the pieces of each upright are joined back together before looking for boxes. */
  const uprights = [];
  for (let i = 0; i < list.fnArray.length; i += 1) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(now);
    else if (fn === OPS.restore) now = stack.pop() || now;
    else if (fn === OPS.transform) now = times(now, args);
    else if (fn === OPS.constructPath) {
      /* Use the path's bounding box rather than parsing the path grammar, which changed between reader versions. */
      const paint = Array.isArray(args?.[0]) ? args[0][args[0].length - 1] : args?.[0];
      const drawn =
        paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke ||
        paint === OPS.eoFillStroke || paint === OPS.closeFillStroke || paint === OPS.closeEOFillStroke;
      const edge = args?.[2];
      if (!drawn || !edge) continue;
      const a = at(now, edge[0], edge[1]);
      const b = at(now, edge[2], edge[3]);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if (w <= size.width * 0.005 && h >= 2) uprights.push({ x, y, h });
    }
  }

  /* The pieces of one upright: the same place across the page, and each one
     carrying on where the last stopped. */
  const JOIN = 3;
  const whole = [];
  for (const piece of uprights.sort((a, b) => a.x - b.x || a.y - b.y)) {
    const run = whole.find(
      (r) => Math.abs(r.x - piece.x) <= 1.5 && piece.y <= r.y + r.h + JOIN && piece.y + piece.h >= r.y - JOIN,
    );
    if (!run) {
      whole.push({ ...piece });
      continue;
    }
    const top = Math.min(run.y, piece.y);
    run.h = Math.max(run.y + run.h, piece.y + piece.h) - top;
    run.y = top;
  }

  /* Two uprights the same height, far enough apart to write between. */
  const found = [];
  const near = (a, b, slack) => Math.abs(a - b) <= slack;
  for (let i = 0; i < whole.length; i += 1) {
    for (let j = i + 1; j < whole.length; j += 1) {
      const [l, r] = whole[i].x <= whole[j].x ? [whole[i], whole[j]] : [whole[j], whole[i]];
      const w = r.x - l.x;
      if (w < size.width * 0.3) continue;
      if (!near(l.y, r.y, 4) || !near(l.y + l.h, r.y + r.h, 4)) continue;
      if (l.h < size.height * 0.02) continue;
      const y = Math.min(l.y, r.y);
      const h = Math.max(l.y + l.h, r.y + r.h) - y;
      if (found.some((f) => near(f.x, l.x, 2) && near(f.y, y, 2) && near(f.h, h, 2))) continue;
      found.push({ x: l.x, y, w, h });
    }
  }

  /* PDF counts up from the foot of the page; everything else counts down. */
  return found
    .map((r) => ({
      x: r.x / size.width,
      y: 1 - (r.y + r.h) / size.height,
      w: r.w / size.width,
      h: r.h / size.height,
    }))
    .sort((a, b) => a.y - b.y);
}

/**
 * Matches the blank's boxes to the drawn ones by left edge and width, which do not move when a box grows,
 * taking height, top and page from the drawing. With nothing drawn, the blank's measurement stands.
 */
export function fitBoxes(map, drawn) {
  const taken = new Set();
  return map.map((b) => {
    let best = null;
    let mark = "";
    for (const [n, sheet] of drawn.entries()) {
      for (const [m, r] of sheet.entries()) {
        const key = `${n}:${m}`;
        if (taken.has(key)) continue;
        /* The map holds the writing area and the drawing its border, so match by shared width, not edges. */
        const over = Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x);
        const share = over / Math.max(b.w, r.w);
        if (share < 0.75) continue;
        if (!best || share > best.share) {
          best = { share, page: n, ...r };
          mark = key;
        }
      }
    }
    if (!best) return b;
    taken.add(mark);
    /* The border is what was found; the writing goes inside it. */
    const pad = Math.min(0.004, best.h / 8);
    return {
      ...b,
      page: best.page,
      x: best.x + pad / 2,
      y: best.y + pad,
      w: Math.max(0.05, best.w - pad),
      h: Math.max(0.02, best.h - pad * 2),
    };
  });
}
