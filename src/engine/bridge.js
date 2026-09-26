/**
 * Which framework units each task group can evidence. The task book and the CAAP
 * framework use different headings; this table lets the panel offer the matching
 * criteria for a document. It is an offer, never a rule: nothing is ticked unasked.
 */
const BRIDGE = {
  "Client and vessel interface": ["Project Activities", "Operational Scope Of Work", "Behavioural Factors"],
  "Equipment and spares": ["Preventative Maintenance", "Specialist Equipment", "Administration"],
  "Fault finding and repair": ["Fault Finding", "Test Equipment"],
  "Launch, recovery and deck": ["ROV Operations", "Workplace Health And Safety", "Piloting An ROV (Piloting / Technical)"],
  "Onshore interface and reporting": ["Administration", "Project Activities"],
  "People and competence": ["Performance Management", "Supervisory And Behavioural Skills", "Behavioural Factors"],
  "Piloting and operations": ["Piloting An ROV (Piloting / Technical)", "ROV Operations"],
  "Planning and risk": ["Workplace Health And Safety", "Operational Scope Of Work", "Project Activities"],
  "Preventative maintenance": ["Preventative Maintenance"],
  "Project and operations management": ["Project Activities", "Operational Scope Of Work", "Administration"],
  "Records and technical administration": ["Administration"],
  "Running the shift": ["Supervisory And Behavioural Skills", "ROV Operations", "Behavioural Factors"],
  "Safety and emergency": ["Workplace Health And Safety", "Emergency Response"],
  "Safety leadership": ["Workplace Health And Safety", "Supervisory And Behavioural Skills"],
  "Survey and inspection": ["Specialist Equipment", "Piloting An ROV (Piloting / Technical)"],
  "Terminations and cables": ["Technical (Umbilical / Tether Termination)"],
  "Tooling and intervention": ["Specialist Equipment", "ROV Operations"],
};

const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
/* Words that head half the list and so tell you nothing about which half. */
const THIN = new Set(["and", "of", "the", "an", "a", "rov", "technical", "piloting", "operations", "activities", "skills", "factors", "scope", "work", "management", "interface"]);
const meat = (s) => new Set(flat(s).split(" ").filter((w) => w.length > 3 && !THIN.has(w)));

/**
 * The framework units a task's group can speak to. Groups not in the table fall
 * back to a word match on the framework's headings; with no match nothing is
 * suggested, because a wrong offer costs more than no offer.
 */
export function unitsBehind(taskUnit, available = []) {
  const named = BRIDGE[taskUnit];
  const have = new Set(available);
  if (named) {
    const hit = named.filter((u) => !available.length || have.has(u));
    if (hit.length) return hit;
  }
  const want = meat(taskUnit);
  if (!want.size) return [];
  return available.filter((u) => {
    const theirs = meat(u);
    for (const w of want) if (theirs.has(w)) return true;
    return false;
  });
}

/** Every framework unit the given tasks could evidence, without repeats. */
export function unitsFromTasks(tasks, available = []) {
  const out = [];
  for (const t of tasks) {
    for (const u of unitsBehind(t.unit || "", available)) if (!out.includes(u)) out.push(u);
  }
  return out;
}
