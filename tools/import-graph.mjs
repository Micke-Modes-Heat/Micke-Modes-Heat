import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const root = resolve('src');
const files = [];
function collect(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) collect(path);
    else if (name.endsWith('.js')) files.push(relative(root, path).replaceAll('\\', '/'));
  }
}
collect(root);

const graph = new Map(files.map(file => [file, []]));
for (const file of files) {
  const source = readFileSync(resolve(root, file), 'utf8');
  const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[1].startsWith('.')) continue;
    const target = relative(root, resolve(root, dirname(file), match[1])).replaceAll('\\', '/');
    if (graph.has(target)) graph.get(file).push(target);
  }
}

let index = 0;
const stack = [], indexes = new Map(), low = new Map(), onStack = new Set(), components = [];
function visit(node) {
  indexes.set(node, index); low.set(node, index); index += 1;
  stack.push(node); onStack.add(node);
  for (const next of graph.get(node)) {
    if (!indexes.has(next)) { visit(next); low.set(node, Math.min(low.get(node), low.get(next))); }
    else if (onStack.has(next)) low.set(node, Math.min(low.get(node), indexes.get(next)));
  }
  if (low.get(node) !== indexes.get(node)) return;
  const component = [];
  let current;
  do { current = stack.pop(); onStack.delete(current); component.push(current); } while (current !== node);
  components.push(component.sort());
}
for (const file of files) if (!indexes.has(file)) visit(file);

const cycles = components.filter(component => component.length > 1).sort((a, b) => b.length - a.length);
const result = {
  files: files.length,
  imports: [...graph.values()].reduce((sum, entries) => sum + entries.length, 0),
  cyclicComponents: cycles.length,
  largestCycle: cycles[0]?.length || 0,
  cycles,
};
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
else {
  console.log(`${result.files} Module · ${result.imports} interne Importe · ${result.cyclicComponents} zyklische Komponenten · größter Zyklus ${result.largestCycle}`);
  cycles.forEach((component, i) => console.log(`\nZyklus ${i + 1} (${component.length}):\n  ${component.join('\n  ')}`));
}
