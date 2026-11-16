/** Capture the existing persisted canvas shape without mutating live nodes. */
export function captureCanvasPersistenceSnapshot(nodes:any[], edges:any[], strip:(data:any)=>any) {
  return {
    nodes:(nodes || []).filter(node=>node.id !== 'ghost-target').map(node=>{
      const data={...strip(node.data || {})};
      for (const key of Object.keys(data)) if (typeof data[key] === 'function') delete data[key];
      if (node.type === 'customNode' && data.config != null) data.config=JSON.parse(JSON.stringify(data.config));
      return {...node,data};
    }),
    edges:(edges || []).filter(edge=>edge.id !== 'ghost-edge'),
  };
}
