import * as tf from "@tensorflow/tfjs-node";
import { padSequences, Tokenizer } from "./tokenizer.js";
import { rubricVec } from "../utils/io.js";
import path from "path";
import fs from "fs";

// Load Universal Sentence Encoder for semantic similarity
import * as use from "@tensorflow-models/universal-sentence-encoder";

const MODEL_DIR = path.resolve("model_store");

function loadTokenizer() {
    const tokJson = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "tokenizer.json"), "utf8"));
    const tok = new Tokenizer();
    tok.wordIndex = tokJson.wordIndex;
    tok.indexWord = Object.fromEntries(Object.entries(tok.wordIndex).map(([w, i]) => [i, w]));
    tok.numWords = tokJson.numWords;
    tok.maxLen = tokJson.maxLen;
    return tok;
}

export async function gradeWithExplanation({ student, reference, rubric }) {
    const model = await tf.loadLayersModel(`file://${MODEL_DIR}/grader/model.json`);
    const tok = loadTokenizer();
    const terms = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, "rubric_vocab.json"), "utf8")).terms;
    const index = new Map(terms.map((t, i) => [t, i]));

    // Encode for CNN+NN
    const sIds = padSequences(tok.textsToSequences([student]), tok.maxLen);
    const rIds = padSequences(tok.textsToSequences([reference]), tok.maxLen);
    const rv = [rubricVec(rubric || [], index, terms.length)];

    const preds = model.predict([
        tf.tensor2d(sIds, [1, tok.maxLen], "int32"),
        tf.tensor2d(rIds, [1, tok.maxLen], "int32"),
        tf.tensor2d(rv, [1, terms.length], "float32")
    ]);
    let raw = (await preds.array())[0][0];

    // Load sentence encoder for bluff detection
    const encoder = await use.load();
    const embeddings = await encoder.embed([student, reference]);
    const embArray = await embeddings.array();
    const sim = cosineSim(embArray[0], embArray[1]); // semantic similarity 0–1

    const studentLower = student.toLowerCase();
    const matchedTerms = rubric.filter(term => studentLower.includes(term.toLowerCase()));
    const missedTerms = rubric.filter(term => !studentLower.includes(term.toLowerCase()));

    // --- Bluff detection ---
    let bluffPenalty = 0;
    const wordCount = studentLower.split(/\s+/).filter(w => w).length;

    // High keyword density but low similarity → bluff
    if (matchedTerms.length > 0 && sim < 0.3) {
        bluffPenalty += 3; // heavy penalty
    }

    // Too short but has keywords
    if (wordCount < matchedTerms.length * 2) {
        bluffPenalty += 2;
    }

    // --- Adjust score ---
    let score10 = Math.round(Math.max(1, Math.min(10, (raw / 5) * 10 - bluffPenalty)));

    // Explanation
    let reason;
    if (score10 <= 2) {
        reason = `Very low score. Either no significant rubric terms matched or detected as bluff. Matched: ${matchedTerms.join(", ") || "None"}`;
    } else if (score10 < 7) {
        reason = `Partial marks — matched terms: ${matchedTerms.join(", ") || "None"}, missing: ${missedTerms.join(", ") || "None"}. Similarity: ${(sim * 100).toFixed(1)}%`;
        if (bluffPenalty > 0) reason += " (Bluff indicators detected)";
    } else {
        reason = `High score — strong match with rubric (${matchedTerms.join(", ")}) and good semantic similarity (${(sim * 100).toFixed(1)}%).`;
    }

    return { score: score10, explanation: reason, matched: matchedTerms, missed: missedTerms, similarity: sim };
}

// --- Helper for cosine similarity ---
function cosineSim(a, b) {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const normB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (normA * normB);
}
