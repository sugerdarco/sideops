import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { createProject, getProject, listProjects, setProjectStatus } from "../lib/store.js";
import { getBuildQueue } from "../lib/queue.js";
import { getSubcriber } from "../lib/redis.js";

export const projectsRouter = Router();

/** POST /projects - create project  
  * input - body : {git_url : string}
  * returns - {projectId, status : queued, url : string}
  */
projectsRouter.post("/", async (req, res) => {
  const git_url = req.body?.git_url;

  if (!git_url || typeof git_url !== "string") {
    return res.status(400).json({ error: "`git_url` is required and must be a string" });
  }

  const trimmed = git_url.trim();
  // accepts - git_utl without or with .git
  const validGit = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/i;
  if (!validGit.test(trimmed)) {
    return res.status(400).json({ error: "Only GitHub HTTPS URLs are supported (e.g. https://github.com/user/repo)" });
  }

  const projectId = uuidv4();
  createProject(projectId, trimmed);

  await getBuildQueue().add("build", { projectId, gitURL: trimmed });

  return res.status(201).json({
    projectId,
    status: "queued",
    url: `http://${projectId}.${process.env.BASE_DOMAIN || "localhost:8080"}`,
  });
});

/** GET /projects - fetch all projects 
  * returns - [projectId];
  */
projectsRouter.get("/", (_req, res) => {
  return res.json(listProjects());
});

/** GET /projects/:id/status - fetch project build status
  * returns - { projectId, status, url }
  */
projectsRouter.get("/:id/status", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  return res.json({
    projectId: project.id,
    status: project.status,
    url: `http://${project.id}.${process.env.BASE_DOMAIN || "localhost:8080"}`,
  });
});

/** GET /projects/:id/logs - SSE(Server send events) to fetch logs
  * Each event published by build worker on channel `logs:<ProjectId>`:
  *   { type: 'logs', line: string } - a log line
  *   { type: 'status', type: string } - terminal status update
  *   
  * SSE evets emmits to the browser:
  *   event: log      data: { line }
  *   event: status   data: { status }
  */
projectsRouter.get("/:id/logs", async (req, res) => {
  const { id } = req.params;

  const project = getProject(id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // helper for SSE 
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // If already in terminal state, send immediately and close 
  if (project.status === "success" || project.status === "failed") {
    send('status', { status: project.status });
    return res.end();
  }

  // keep-alive heartbeat every 20 sec (prevets proxy / browser timeout)
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 2000);

  const channel = `logs:${id}`;
  const sub = getSubcriber();

  const onMessage = (ch, raw) => {
    if (ch !== channel) return;
    try {
      const payload = JSON.parse(raw);

      if (payload.type === "log") {
        send('log', { line: payload.line });
      } else if (payload.type === "status") {
        setProjectStatus(id, payload.status);
        send('status', { status: payload.status });

        // build is done - close the stream and cleanup 
        if (payload.status === "success" || payload.status === "failed") {
          cleanup();
        }
      }
    } catch {
      // Malformed Json from redis - skip sliently
    }
  }

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    sub.off('message', onMessage);
    sub.unsubscribe(channel).catch(() => { });
    if (!res.writableEnded) res.end();
  };

  sub.on('message', onMessage);
  await sub.subscribe(channel);

  req.on('close', cleanup);
})

