// Runs a node graph
export function makeEvaluator(graph, defs, ctx) {
  const cache = new Map(), busy = new Set();
  const byId = id => graph.nodes.find(n => n.id === id);

  const out = (node, socket) => {
    if (!cache.has(node.id)) {
      if (busy.has(node.id)) throw new Error('The node graph has a loop');
      busy.add(node.id);
      const def = defs[node.type];
      const get = name => {
        const link = graph.links.find(l => l.to === node.id && l.toSocket === name);
        if (link) return out(byId(link.from), link.fromSocket);
        return node.values?.[name] ?? def.inputs.find(i => i.name === name).value;
      };
      cache.set(node.id, def.run(get, ctx, node));
      busy.delete(node.id);
    }
    return cache.get(node.id)[socket];
  };
  return { out, byId };
}
