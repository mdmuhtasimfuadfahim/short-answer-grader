import "dotenv/config"; // Load environment variables from .env file
import express from "express";
import { gradeWithExplanation } from "./model/predict.js";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

const QUESTIONS = JSON.parse(fs.readFileSync(path.join("data", "questions.json"), "utf8"));

// POST /grade?qid=q1
app.post("/grade", async (req, res) => {
    try {
        const { student } = req.body;
        const { qid } = req.query;

        if (!qid || !QUESTIONS[qid]) {
            return res.status(400).json({ ok: false, error: "Invalid question ID" });
        }

        const { reference, rubric } = QUESTIONS[qid];

        const result = await gradeWithExplanation({
            student,
            reference,
            rubric
        });

        res.json({ ok: true, ...result });
    } catch (e) {
        console.error(e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
