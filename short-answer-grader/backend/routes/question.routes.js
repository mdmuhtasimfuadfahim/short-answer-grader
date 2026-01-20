/**
 * Question routes
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const questionController = require('../controllers/question.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Validation
const validateQuestion = [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('content').trim().notEmpty().withMessage('Question content is required'),
    body('referenceAnswer').trim().notEmpty().withMessage('Reference answer is required'),
    body('maxScore').optional().isInt({ min: 1 }).withMessage('Max score must be positive')
];

// All routes require authentication
router.use(authenticate);

// Routes
router.get('/', questionController.getQuestions);
router.get('/:id', questionController.getQuestion);
router.get('/:id/stats', questionController.getQuestionStats);

// Teacher-only routes
router.post('/', authorize('teacher', 'admin'), validateQuestion, questionController.createQuestion);
router.put('/:id', authorize('teacher', 'admin'), questionController.updateQuestion);
router.delete('/:id', authorize('teacher', 'admin'), questionController.deleteQuestion);

module.exports = router;