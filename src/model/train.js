import * as tf from "@tensorflow/tfjs-node";
import { Tokenizer, padSequences } from "./tokenizer.js";
import { buildTextCnnEncoder } from "./cnn.js";
import { buildGraderModel } from "./scorer.js";
import { readJsonl, buildRubricVocab, rubricVec } from "../utils/io.js";
import path from "path";
import fs from "fs";

const MAX_LEN = 64;
const MODEL_DIR = path.resolve("model_store");

function toArrays(arr) {
    return {
        student: arr.map(x => x.student),
        reference: arr.map(x => x.reference),
        rubric: arr.map(x => x.rubric || []),
        score: arr.map(x => Number(x.score))
    };
}

async function main() {
    const train = readJsonl("data/train.jsonl");
    const dev = readJsonl("data/dev.jsonl");

    const { terms, index, size: rubricDim } = buildRubricVocab([...train, ...dev]);

    // Tokenizer over both student+reference text
    const tok = new Tokenizer();
    tok.fitOnTexts([...train, ...dev].flatMap(x => [x.student, x.reference]));
    const vocabSize = tok.numWords;

    const tr = toArrays(train);
    const dv = toArrays(dev);

    const Xs_ids = padSequences(tok.textsToSequences(tr.student), MAX_LEN);
    const Xr_ids = padSequences(tok.textsToSequences(tr.reference), MAX_LEN);
    const Xrub = tr.rubric.map(r => rubricVec(r, index, rubricDim));
    const y = tr.score;

    const Vs_ids = padSequences(tok.textsToSequences(dv.student), MAX_LEN);
    const Vr_ids = padSequences(tok.textsToSequences(dv.reference), MAX_LEN);
    const Vrub = dv.rubric.map(r => rubricVec(r, index, rubricDim));
    const vy = dv.score;

    const encoder = buildTextCnnEncoder({ vocabSize, maxLen: MAX_LEN });
    const model = buildGraderModel({ encoder, rubricDim, hidden: 256, outMax: 5 });

    console.log(model.summary());

    // Tensors
    const trainInputs = {
        student_ids: tf.tensor2d(Xs_ids, [Xs_ids.length, MAX_LEN], "int32"),
        reference_ids: tf.tensor2d(Xr_ids, [Xr_ids.length, MAX_LEN], "int32"),
        rubric_vec: tf.tensor2d(Xrub)
    };
    const trainLabels = tf.tensor2d(y, [y.length, 1]);

    const valInputs = {
        student_ids: tf.tensor2d(Vs_ids, [Vs_ids.length, MAX_LEN], "int32"),
        reference_ids: tf.tensor2d(Vr_ids, [Vr_ids.length, MAX_LEN], "int32"),
        rubric_vec: tf.tensor2d(Vrub)
    };
    const valLabels = tf.tensor2d(vy, [vy.length, 1]);

    // Train (Backpropagation handled by tfjs automatically under the hood)
    const history = await model.fit(trainInputs, trainLabels, {
        epochs: 6,
        batchSize: 32,
        validationData: [valInputs, valLabels],
        callbacks: [
            tf.callbacks.earlyStopping({ monitor: "val_loss", patience: 2, restoreBestWeight: true })
        ]
    });

    console.log("Training history:", history.history);

    // Save assets
    fs.mkdirSync(MODEL_DIR, { recursive: true });
    await model.save(`file://${MODEL_DIR}/grader`);
    fs.writeFileSync(path.join(MODEL_DIR, "tokenizer.json"), JSON.stringify({
        wordIndex: tok.wordIndex, numWords: tok.numWords, maxLen: MAX_LEN
    }, null, 2));
    fs.writeFileSync(path.join(MODEL_DIR, "rubric_vocab.json"), JSON.stringify({ terms }, null, 2));

    console.log("Saved model + tokenizer to", MODEL_DIR);
}

main().catch(err => { console.error(err); process.exit(1); });
