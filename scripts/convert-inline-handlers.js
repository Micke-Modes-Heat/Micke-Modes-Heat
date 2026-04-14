#!/usr/bin/env node
/**
 * Konvertiert inline Event-Handler (onclick, oninput, onchange, onkeydown)
 * in index.html zu data-* Attribute und generiert Event-Delegation-Code.
 *
 * Strategie:
 * - onclick="foo()"        → data-click="foo()"
 * - oninput="foo()"        → data-input="foo()"
 * - onchange="foo()"       → data-change="foo()"
 * - onkeydown="foo(event)" → data-keydown="foo(event)"
 *
 * Event-Delegation in 12-inline-handlers.js fängt diese ab.
 */

const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const HANDLER_TYPES = ['onclick', 'onchange', 'oninput', 'onkeydown', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'];
const DATA_MAP = {
  onclick: 'data-click',
  onchange: 'data-change',
  oninput: 'data-input',
  onkeydown: 'data-keydown',
  onmouseover: 'data-mouseover',
  onmouseout: 'data-mouseout',
  onfocus: 'data-focus',
  onblur: 'data-blur',
};

let count = 0;

for (const handler of HANDLER_TYPES) {
  const regex = new RegExp(`\\s${handler}="([^"]*)"`, 'g');
  html = html.replace(regex, (match, code) => {
    count++;
    const dataAttr = DATA_MAP[handler];
    return ` ${dataAttr}="${code}"`;
  });
}

fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`Konvertiert: ${count} inline Handler → data-* Attribute`);
