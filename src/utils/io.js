import fs from "fs";

export function readJsonl(path) {
    const raw = fs.readFileSync(path, "utf8").trim().split(/\r?\n/);
    return raw.filter(Boolean).map(line => JSON.parse(line));
}

export function buildRubricVocab(records) {
    const set = new Map();
    records.forEach(r => (r.rubric || []).forEach(term => set.set(term.toLowerCase(), true)));
    const arr = [...set.keys()];
    const index = new Map(arr.map((t, i) => [t, i]));
    return { terms: arr, index, size: arr.length };
}

export function rubricVec(rubricTerms, index, size) {
    const v = new Array(size).fill(0);
    (rubricTerms || []).forEach(t => {
        const i = index.get(String(t).toLowerCase());
        if (i !== undefined) v[i] = 1;
    });
    return v;
}
