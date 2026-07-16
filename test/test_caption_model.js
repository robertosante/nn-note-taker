const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CaptionAccumulator,
  captionStreamKey,
  classifyCaptionRevision,
  consolidateObservations
} = require("../extension/content/caption-model.js");

test("growing caption updates one stable record", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Ana");

  const first = accumulator.commit(stream, "Ana", "Necesitamos revisar", 1_000);
  const second = accumulator.commit(stream, "Ana", "Necesitamos revisar el contrato", 2_000);

  assert.equal(first.action, "insert");
  assert.equal(second.action, "update");
  assert.equal(accumulator.all().length, 1);
  assert.equal(accumulator.all()[0].text, "Necesitamos revisar el contrato");
});

test("participant key survives a replacement DOM node", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const firstNodeStream = captionStreamKey("Ana", "old-node");
  const replacementNodeStream = captionStreamKey("Ana", "new-node");

  accumulator.commit(firstNodeStream, "Ana", "Hola equipo", 1_000);
  const update = accumulator.commit(replacementNodeStream, "Ana", "Hola equipo, comenzamos", 2_000);

  assert.equal(firstNodeStream, replacementNodeStream);
  assert.equal(update.action, "update");
  assert.equal(accumulator.all().length, 1);
});

test("participant casing and self aliases keep the same stream", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const upper = captionStreamKey("ANA");
  const title = captionStreamKey("Ana");
  const selfInSpanish = captionStreamKey("Tú");
  const selfAlternative = captionStreamKey("Yo");

  accumulator.commit(upper, "ANA", "Revisemos el contrato", 1_000);
  accumulator.commit(title, "Ana", "Revisemos el contrato mañana", 2_000);

  assert.equal(upper, title);
  assert.equal(selfInSpanish, selfAlternative);
  assert.equal(accumulator.all().length, 1);
  assert.equal(accumulator.all()[0].speaker, "Ana");
});

test("caption corrections in punctuation, case, and the unstable tail update in place", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Tú");

  accumulator.commit(stream, "Tú", "Hola que tal como estan. Que ser. Say.", 1_000);
  const correctedTail = accumulator.commit(
    stream,
    "Tú",
    "Hola que tal como estan. Esta cabron. No nego que podema Sos.",
    2_000
  );
  const correctedPunctuation = accumulator.commit(
    stream,
    "Tú",
    "Hola qué tal cómo están, esta cabrón. Lo único que podemos hacer es revisar.",
    3_000
  );

  assert.equal(correctedTail.action, "update");
  assert.equal(correctedPunctuation.action, "update");
  assert.equal(accumulator.all().length, 1);
  assert.match(accumulator.all()[0].text, /Lo único/);
});

test("a transient shorter caption does not replace the fuller revision", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Ana");

  accumulator.commit(stream, "Ana", "Vamos a revisar toda la arquitectura completa", 1_000);
  const stale = accumulator.commit(stream, "Ana", "Vamos a revisar", 2_000);

  assert.equal(stale.action, "ignored");
  assert.equal(stale.reason, "same-or-stale");
  assert.equal(accumulator.all()[0].text, "Vamos a revisar toda la arquitectura completa");
});

test("the reported Meet correction chain becomes one final caption", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Tú");
  const revisions = [
    "Hola.",
    "Hola que tal como estan.",
    "Hola que tal como estan. Que ser. Say.",
    "Hola que tal como estan. Esta cabron. No nego que podema Sos.",
    "Hola que tal como estan. Esta cabron. Lo unigo, que podemos hacer es.",
    "Hola Qué tal cómo están.",
    "Hola Qué tal cómo están. hay que revisar toda la arquitectura completa que hay ahorita porque no lo tenemos bien definida entonces hay que rehacer los usuarios los Stories",
    "Hola Qué tal cómo están. Hay que revisar toda la arquitectura completa que hay ahorita porque no lo tenemos bien definida, entonces hay que rehacer los usuarios los Stories todo en fin, lo que tengamos desechable.",
    "Hola Qué tal cómo están. Hay que revisar toda la arquitectura completa que hay ahorita porque no lo tenemos bien definida, entonces hay que rehacer los usuarios los Stories todo en fin, lo que tengamos desechable. Sí sí, así está bien Eso es lo que tenemos que hacer."
  ];

  revisions.forEach((text, index) => accumulator.commit(stream, "Tú", text, index * 5_000));

  assert.equal(accumulator.all().length, 1);
  assert.equal(accumulator.all()[0].text, revisions.at(-1));
});

test("different utterance in the same active stream creates a new record", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Ana");
  accumulator.commit(stream, "Ana", "Primera idea", 1_000);
  const second = accumulator.commit(stream, "Ana", "Segunda idea", 8_000);

  assert.equal(second.action, "insert");
  assert.equal(accumulator.all().length, 2);
});

test("interleaved participants retain independent active captions", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const ana = captionStreamKey("Ana");
  const bob = captionStreamKey("Bob");

  accumulator.commit(ana, "Ana", "Revisemos el contrato", 1_000);
  accumulator.commit(bob, "Bob", "Yo tomo la tarea", 2_000);
  const anaUpdate = accumulator.commit(ana, "Ana", "Revisemos el contrato mañana", 3_000);

  assert.equal(anaUpdate.action, "update");
  assert.equal(accumulator.all().length, 2);
  assert.equal(accumulator.all().find((record) => record.speaker === "Ana").text, "Revisemos el contrato mañana");
});

test("closing a participant stream creates a hard utterance boundary", () => {
  const accumulator = new CaptionAccumulator("meet_demo");
  const stream = captionStreamKey("Ana");
  accumulator.commit(stream, "Ana", "Primera participación", 1_000);
  accumulator.closeStream(stream);
  const next = accumulator.commit(stream, "Ana", "Primera participación, retomada", 20_000);

  assert.equal(next.action, "insert");
  assert.equal(accumulator.all().length, 2);
});

test("duplicate DOM observations for a participant keep only the newest revision", () => {
  const observations = consolidateObservations([
    { source: {}, slot: 0, speaker: "Ana", text: "Hola equipo." },
    { source: {}, slot: 1, speaker: "Ana", text: "Hola equipo, comenzamos." },
    { source: {}, slot: 2, speaker: "Bob", text: "Listo." }
  ]);

  assert.equal(observations.length, 2);
  assert.equal(observations.find((item) => item.speaker === "Ana").text, "Hola equipo, comenzamos.");
});

test("revision classifier distinguishes correction from a new utterance", () => {
  assert.equal(classifyCaptionRevision("Hasta el gira me propuso.", "Hasta el gira me propuso, qué onda."), "revision");
  assert.equal(classifyCaptionRevision("Vamos a revisar el contrato", "Vamos a revisar"), "stale");
  assert.equal(classifyCaptionRevision("Primera idea", "Segunda idea"), "distinct");
});
