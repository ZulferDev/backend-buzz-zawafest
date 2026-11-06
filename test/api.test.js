import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createStateStore } from "../src/database.js";
import { createEmptyState } from "../src/state.js";

function setup() {
  const store = createStateStore();
  return { app: createApp({ store }), store };
}

function stateWithTeams() {
  return {
    ...createEmptyState(),
    teams: [
      { id: "team-1", name: "Tim Satu", score: 0, soundData: "" },
      { id: "team-2", name: "Tim Dua", score: 5, soundData: "" },
    ],
    questions: [{ id: "question-1", group: "Umum", text: "Pertanyaan?", answer: "Jawaban", value: 10 }],
    currentQuestionId: "question-1",
    rebuttalOpen: true,
  };
}

test("mengambil state awal dengan revision nol", async () => {
  const { app, store } = setup();
  const response = await app.request("/api/state");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.revision, 0);
  assert.deepEqual(body.state.teams, []);
  store.close();
});

test("menyimpan state dan menolak revision yang sudah kedaluwarsa", async () => {
  const { app, store } = setup();
  const state = stateWithTeams();
  const saved = await app.request("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, expectedRevision: 0 }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);

  const conflict = await app.request("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, expectedRevision: 0 }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).latest.revision, 1);
  store.close();
});

test("memvalidasi state dan mengunci hanya satu buzzer secara atomik", async () => {
  const { app, store } = setup();
  const saved = await app.request("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: stateWithTeams(), expectedRevision: 0 }),
  });
  assert.equal(saved.status, 200);

  const buzzResponses = await Promise.all(["team-1", "team-2"].map((teamId) => app.request("/api/buzzer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
  })));
  const results = await Promise.all(buzzResponses.map((response) => response.json()));
  assert.equal(results.filter((result) => result.accepted).length, 1);
  assert.equal(results.find((result) => !result.accepted).state.buzzerTeamId, results.find((result) => result.accepted).state.buzzerTeamId);

  const invalid = await app.request("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: { ...stateWithTeams(), currentQuestionId: "missing" }, expectedRevision: 2 }),
  });
  assert.equal(invalid.status, 422);
  store.close();
});

test("mendorong state yang tersimpan ke callback broadcast", async () => {
  const store = createStateStore();
  const messages = [];
  const app = createApp({ store, broadcast: (message) => messages.push(message) });
  const response = await app.request("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: stateWithTeams(), expectedRevision: 0 }),
  });

  assert.equal(response.status, 200);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "state");
  assert.equal(messages[0].revision, 1);
  store.close();
});
