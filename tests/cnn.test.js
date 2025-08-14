import * as tf from "@tensorflow/tfjs-node";
import { buildTextCnnEncoder } from "../src/model/cnn.js";

test("CNN encoder builds and outputs correct shape", () => {
    const enc = buildTextCnnEncoder({ vocabSize: 1000, maxLen: 16 });
    const outShape = enc.outputs[0].shape;
    expect(outShape.length).toBe(2);          // [batch, features]
    expect(outShape[0]).toBeNull();           // batch dimension
    expect(outShape[1]).toBeGreaterThan(0);   // feature dim > 0
});
