import * as tf from "@tensorflow/tfjs-node";
import { Tokenizer, padSequences } from "../src/model/tokenizer.js";
import { buildTextCnnEncoder } from "../src/model/cnn.js";
import { buildGraderModel } from "../src/model/scorer.js";

test("Backprop reduces loss on synthetic data", async () => {
    const MAX_LEN = 12;
    const pairs = [
        { s: "nn has nodes and weights", r: "neural network has nodes and weights", rub: ["nodes", "weights"], y: 5 },
        { s: "just random keywords", r: "neural network has nodes and weights", rub: ["nodes", "weights"], y: 1 },
        { s: "training adjusts weights", r: "model learns by adjusting weights during training", rub: ["training", "weights"], y: 5 },
        { s: "no relation", r: "model learns by adjusting weights during training", rub: ["training", "weights"], y: 1 }
    ];

    const tok = new Tokenizer();
    tok.fitOnTexts(pairs.flatMap(p => [p.s, p.r]));
    const rubricTerms = ["nodes", "weights", "training"];
    const rubIndex = new Map(rubricTerms.map((t, i) => [t, i]));

    const sSeq = padSequences(tok.textsToSequences(pairs.map(p => p.s)), MAX_LEN);
    const rSeq = padSequences(tok.textsToSequences(pairs.map(p => p.r)), MAX_LEN);
    const rubV = pairs.map(p => {
        const v = new Array(rubricTerms.length).fill(0);
        p.rub.forEach(t => { const i = rubIndex.get(t); if (i !== undefined) v[i] = 1; });
        return v;
    });
    const y = pairs.map(p => p.y);

    const encoder = buildTextCnnEncoder({ vocabSize: tok.numWords, maxLen: MAX_LEN });
    const model = buildGraderModel({ encoder, rubricDim: rubricTerms.length, hidden: 64 });

    const inputs = {
        student_ids: tf.tensor2d(sSeq, [sSeq.length, MAX_LEN], "int32"),
        reference_ids: tf.tensor2d(rSeq, [rSeq.length, MAX_LEN], "int32"),
        rubric_vec: tf.tensor2d(rubV)
    };
    const labels = tf.tensor2d(y, [y.length, 1]);

    const h = await model.fit(inputs, labels, { epochs: 20, batchSize: 2, verbose: 0 });
    const first = h.history.loss[0];
    const last = h.history.loss[h.history.loss.length - 1];

    expect(last).toBeLessThan(first); // training reduced loss -> backprop working
});
