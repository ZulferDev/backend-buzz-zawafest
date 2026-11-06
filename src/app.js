import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { RevisionConflictError, StateValidationError } from "./database.js";

export function createApp({ store, allowedOrigins = [], broadcast = () => {} }) {
  const app = new Hono();
  const originAllowed = (origin) => !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);

  app.use("/api/*", cors({
    origin: (origin) => originAllowed(origin) ? origin : null,
    allowMethods: ["GET", "PUT", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  }));
  app.use("/api/state", bodyLimit({ maxSize: 5 * 1024 * 1024 }));
  app.use("/api/buzzer", bodyLimit({ maxSize: 16 * 1024 }));
  app.use("/api/ws", async (context, next) => {
    if (!originAllowed(context.req.header("origin"))) {
      return context.json({ error: "origin_not_allowed" }, 403);
    }
    return next();
  });

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.get("/api/state", (context) => context.json(store.read()));
  app.get("/api/teams", (context) => {
    const snapshot = store.read();
    return context.json({ revision: snapshot.revision, teams: snapshot.state.teams });
  });
  app.get("/api/questions", (context) => {
    const snapshot = store.read();
    return context.json({
      revision: snapshot.revision,
      questions: snapshot.state.questions,
      currentQuestionId: snapshot.state.currentQuestionId,
    });
  });

  app.put("/api/state", async (context) => {
    const body = await context.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "invalid_json", message: "Body harus berupa objek JSON." }, 400);
    }

    try {
      const snapshot = store.replace(body.state, body.expectedRevision);
      broadcast({ type: "state", ...snapshot });
      return context.json(snapshot);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return context.json({
          error: "revision_conflict",
          message: error.message,
          latest: error.latest,
        }, 409);
      }
      if (error instanceof StateValidationError) {
        return context.json({ error: "invalid_state", message: error.message, issues: error.issues }, 422);
      }
      throw error;
    }
  });

  app.post("/api/buzzer", async (context) => {
    const body = await context.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "invalid_json", message: "Body harus berupa objek JSON." }, 400);
    }
    try {
      const result = store.claimBuzzer(body.teamId);
      if (result.accepted) {
        const { accepted, ...snapshot } = result;
        broadcast({ type: "state", ...snapshot });
      }
      return context.json(result);
    } catch (error) {
      if (error instanceof StateValidationError) {
        return context.json({ error: "invalid_request", message: error.message, issues: error.issues }, 422);
      }
      throw error;
    }
  });

  app.get("/api/ws", (context) => context.text("WebSocket upgrade required.", 426));

  app.onError((error, context) => {
    if (error instanceof HTTPException) {
      return context.json({ error: "request_rejected", message: error.message }, error.status);
    }
    console.error("[api] Unhandled request error:", error);
    return context.json({ error: "internal_error", message: "Terjadi kesalahan pada server." }, 500);
  });

  return app;
}
