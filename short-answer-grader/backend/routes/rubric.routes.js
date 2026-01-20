/**
 * Rubric routes
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rubricController = require('../controllers/rubric.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Validation
const validateRubric = [
    body('name').trim().notEmpty().withMessage('Rubric name is required'),
    body('dimensions').isArray({ min: 1 }).withMessage('At least one dimension is required'),
    body('dimensions.*.name').trim().notEmpty().withMessage('Dimension name is required'),
    body('dimensions.*.description').trim().notEmpty().withMessage('Dimension description is required')
];

// All routes require authentication and teacher role
router.use(authenticate);
router.use(authorize('teacher', 'admin'));

// Routes
router.get('/', rubricController.getRubrics);
router.get('/:id', rubricController.getRubric);
router.post('/', validateRubric, rubricController.createRubric);
router.put('/:id', rubricController.updateRubric);
router.delete('/:id', rubricController.deleteRubric);
router.post('/:id/clone', rubricController.cloneRubric);
router.post('/:id/normalize', rubricController.normalizeWeights);

module.exports = router;