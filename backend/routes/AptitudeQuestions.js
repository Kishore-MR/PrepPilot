const express = require("express");
const { generateWithFallback } = require("../utils/geminiHelper");
const NodeCache = require("node-cache");

const questionCache = new NodeCache({
  stdTTL: 3600,
});

const router = express.Router();
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

// GET /api/questions?topic=Probability
router.get("/", async (req, res) => {
  const { topic } = req.query;

  // 1. Check whether topic is a string
  if (typeof topic !== "string") {
    return res.status(400).json({
      error: "Topic must be a string",
    });
  }

  // 2. Remove unnecessary spaces
  const cleanedTopic = topic.trim();

  // 3. Check empty topic
  if (!cleanedTopic) {
    return res.status(400).json({
      error: "Topic is required",
    });
  }

  // 4. Restrict topic length
  if (cleanedTopic.length > 100) {
    return res.status(400).json({
      error: "Topic must not exceed 100 characters",
    });
  }

  // 5. Reject unsafe characters
  if (/[<>]|[\x00-\x1F\x7F]/.test(cleanedTopic)) {
    return res.status(400).json({
      error: "Topic contains invalid characters",
    });
  }

  // 6. Normalize topic for caching
  const normalizedTopic = cleanedTopic.toLowerCase();
  const cacheKey = `questions:${normalizedTopic}`;

  // 7. Check cache
  const cachedQuestions = questionCache.get(cacheKey);

  if (cachedQuestions) {
    return res.json(cachedQuestions);
  }

  // 8. Generate prompt using validated topic
  const prompt = `
    Generate 5 multiple-choice aptitude questions on the topic: ${cleanedTopic}.
    Each question should have 4 options and indicate the correct answer in JSON format like:
    [
      {
        "question": "...",
        "options": ["A", "B", "C", "D"],
        "answer": "A"
      },
      ...
    ]
    Only return valid JSON, no extra text.
  `;

  try {
    const { result } = await generateWithFallback(
      process.env.GEMINI_API_KEY,
      [prompt],
      {},
      MAX_RETRIES,
      INITIAL_DELAY
    );

    const rawText = await result.response.text();

    let cleanedText = rawText
      .replace(/^\s*```json\s*/i, "")
      .replace(/^\s*```\s*/i, "")
      .replace(/(\s*```\s*)+$/i, "")
      .trim();

    let questions;

    try {
      questions = JSON.parse(cleanedText);
    } catch (err) {
      console.error("Gemini raw response:", rawText);
      console.error("Parse error:", err);

      return res.status(500).json({
        error: "Failed to parse Gemini response",
      });
    }

    questionCache.set(cacheKey, questions);

    return res.json(questions);

  } catch (error) {
    console.error("Gemini API error:", error);

    return res.status(500).json({
      error: "Failed to generate questions",
    });
  }
});

module.exports = router;
