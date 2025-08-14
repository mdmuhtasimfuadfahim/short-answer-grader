import * as tf from "@tensorflow/tfjs-node";

// Returns a keras-style tf.Model that encodes text sequences to a fixed vector
export function buildTextCnnEncoder({ vocabSize, maxLen, embedDim = 128, numFilters = 128, kernelSizes = [3, 4, 5], dropout = 0.2 }) {
    const input = tf.input({ shape: [maxLen], dtype: "int32", name: "text_ids" });
    const embed = tf.layers.embedding({ inputDim: vocabSize, outputDim: embedDim, name: "embed" }).apply(input);

    // Multiple conv branches (CNN for phrase/n-gram patterns)
    const convBranches = kernelSizes.map(k =>
        tf.layers
            .conv1d({ filters: numFilters, kernelSize: k, activation: "relu", padding: "valid" })
            .apply(embed)
    );

    const pooled = convBranches.map(b => tf.layers.globalMaxPool1d().apply(b));
    const merged = pooled.length > 1 ? tf.layers.concatenate().apply(pooled) : pooled[0];

    const bn = tf.layers.batchNormalization().apply(merged);
    const dropped = tf.layers.dropout({ rate: dropout }).apply(bn);

    return tf.model({ inputs: input, outputs: dropped, name: "text_cnn_encoder" });
}
