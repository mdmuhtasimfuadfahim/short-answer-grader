import * as tf from "@tensorflow/tfjs-node";

// Combine student/ref encodings + rubric vector and predict a score.
export function buildGraderModel({ encoder, rubricDim, hidden = 256, outMax = 5 }) {
    const studentIn = tf.input({ shape: encoder.inputs[0].shape.slice(1), dtype: "int32", name: "student_ids" });
    const refIn = tf.input({ shape: encoder.inputs[0].shape.slice(1), dtype: "int32", name: "reference_ids" });
    const rubricIn = tf.input({ shape: [rubricDim], dtype: "float32", name: "rubric_vec" });

    // Shared encoder: CNN from cnn.js
    const sVec = encoder.apply(studentIn);
    const rVec = encoder.apply(refIn);

    // Keep a strong interaction signal
    const elemMul = tf.layers.multiply().apply([sVec, rVec]);

    // Concatenate raw encodings + interaction + rubric vector
    const feat = tf.layers.concatenate().apply([sVec, rVec, elemMul, rubricIn]);

    // Dense head (Neural Network)
    const h1 = tf.layers.dense({ units: hidden, activation: "relu" }).apply(feat);
    const h2 = tf.layers.dense({ units: Math.floor(hidden / 2), activation: "relu" }).apply(h1);
    const out = tf.layers.dense({ units: 1, activation: "linear" }).apply(h2); // regression

    const model = tf.model({ inputs: [studentIn, refIn, rubricIn], outputs: out, name: "short_answer_grader" });

    model.compile({
        optimizer: tf.train.adam(1e-3),
        loss: "meanSquaredError",
        metrics: ["mae"]
    });

    model.outMax = outMax;
    return model;
}
