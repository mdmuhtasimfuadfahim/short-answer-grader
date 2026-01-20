/**
 * Grading routes
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const gradingController = require('../controllers/grading.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Validation
const validateSubmission = [
    body('questionId').notEmpty().withMessage('Question ID is required'),
    body('answerText').trim().notEmpty().withMessage('Answer text is required')
];

// Health check (no auth required)
router.get('/health', gradingController.checkMLHealth);

// All other routes require authentication
router.use(authenticate);

// Student routes
router.post('/submit', validateSubmission, gradingController.submitAnswer);
router.get('/my-submissions', gradingController.getMySubmissions);
router.get('/submissions/:id', gradingController.getSubmission);
router.post('/submissions/:id/regrade', gradingController.regradeSubmission);

// Teacher routes
router.get('/questions/:questionId/submissions', authorize('teacher', 'admin'), gradingController.getQuestionSubmissions);
router.put('/submissions/:id/override', authorize('teacher', 'admin'), gradingController.overrideScore);

// Batch grading (teacher only)
router.post(
    '/batch-grade',
    authorize('teacher', 'admin'),
    gradingController.batchGrade
);

module.exports = router;