/**
 * Lightweight in-memory project registory.
 *  It replace by the actual db like postgress
 *  we have small registory so in-memory is enough.
 *
 *  Shape: 
 *    {id, gitURL, status, createdAt}
 *
 *    @typeof status - 'queued', || 'building' || 'success' || 'failed';
 **/

const store = new Map(); // entry - <String, Project>

export function createProject(id, gitURL) {
  const project = {
    id,
    gitURL,
    status: ("queued"),
    createdAt: new Date().toISOString(),
  }

  store.set(id, project);
  return project;
}

export function getProject(id) {
  return store.get(id) ?? null;
}

export function setProjectStatus(id, status) {
  const p = store.get(id);

  if (p) {
    p.status = status;
    store.set(id, p);
  }
}

export function listProjects() {
  return [...store.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}
