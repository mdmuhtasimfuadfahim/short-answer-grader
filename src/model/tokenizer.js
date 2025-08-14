// A tiny word-level tokenizer + padding utility for tfjs-node
export class Tokenizer {
    constructor({ lower = true, oovToken = "<OOV>" } = {}) {
        this.lower = lower;
        this.oovToken = oovToken;
        this.wordIndex = { [oovToken]: 1 }; // 0 is reserved for padding
        this.indexWord = { 1: oovToken };
        this.numWords = 2;
    }

    _normalize(text) {
        return this.lower ? String(text || "").toLowerCase() : String(text || "");
    }

    fitOnTexts(texts) {
        const vocab = new Map();
        texts.forEach(t => {
            this._normalize(t).split(/\s+/).forEach(w => {
                if (!w) return;
                vocab.set(w, (vocab.get(w) || 0) + 1);
            });
        });
        // frequency-based index
        const sorted = [...vocab.entries()].sort((a, b) => b[1] - a[1]);
        sorted.forEach(([w]) => {
            if (this.wordIndex[w]) return;
            const idx = this.numWords++;
            this.wordIndex[w] = idx;
            this.indexWord[idx] = w;
        });
    }

    textsToSequences(texts) {
        return texts.map(t =>
            this._normalize(t).split(/\s+/).map(w => this.wordIndex[w] || 1)
        );
    }
}

export function padSequences(seqs, maxLen) {
    return seqs.map(s => {
        const arr = new Array(maxLen).fill(0);
        const cut = s.slice(0, maxLen);
        arr.splice(0, cut.length, ...cut);
        return arr;
    });
}
