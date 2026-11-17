// Petit constructeur de DOM. Le texte passe toujours par textContent : aucune injection HTML possible.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'hidden') el.hidden = Boolean(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Gribouillis de craie animé : on voit que l'autre écrit, jamais ce qu'il écrit. */
export function scribble() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'scribble');
  svg.setAttribute('viewBox', '0 0 120 26');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M4 18 C 14 4, 22 24, 32 12 S 50 4, 58 16 S 76 22, 84 8 S 104 6, 116 16');
  svg.append(path);
  return svg;
}

export function setScribble(svg, state) {
  svg.classList.remove('erase', 'idle', 'done');
  if (state && state !== 'writing') svg.classList.add(state);
}
