/** How a team member is shown in pickers. Two accounts can share a name (e.g. a real "Priya Sharma" and an old demo
 *  account), and picking by name alone gives the work to the wrong one, so same-named people get their email added. */
export function personLabeller(people: { name: string; email: string }[]) {
  const count = new Map<string, number>();
  for (const p of people) count.set(p.name, (count.get(p.name) ?? 0) + 1);
  return (p: { name: string; email: string }) => ((count.get(p.name) ?? 0) > 1 ? `${p.name} (${p.email})` : p.name);
}
