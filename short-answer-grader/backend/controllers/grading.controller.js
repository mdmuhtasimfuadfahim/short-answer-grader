/**
 * Grading controller
 */
const Submission = require('../models/Submission');
const Question = require('../models/Question');
const Rubric = require('../models/Rubric');
const mlService = require('../utils/mlService');

/**
 * Submit an answer for grading
 * POST /api/grading/submit
 */
const submitAnswer = async (req, res) => {
    try {
        const { questionId, answerText } = req.body;
        
        // Get question with rubric
        const question = await Question.findById(questionId).populate('rubric');
        
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        if (!question.isActive) {
            return res.status(400).json({
                success: false,
                message: 'This question is no longer accepting submissions'
            });
        }
        
        // Check for existing submission
        let submission = await Submission.findOne({
            student: req.userId,
            question: questionId
        });
        
        if (submission) {
            // Update existing submission
            submission.answerText = answerText;
            submission.attempts += 1;
            submission.status = 'pending';
            submission.submittedAt = new Date();
        } else {
            // Create new submission
            submission = new Submission({
                student: req.userId,
                question: questionId,
                answerText,
                status: 'pending'
            });
        }
        
        await submission.save();
        
        // Trigger async grading
        submission.status = 'grading';
        await submission.save();
        
        try {
            // Prepare rubric dimensions
            let rubricDims = null;
            let referenceAnswer = null;
            
            if (question.rubric && question.rubric.dimensions.length > 0) {
                rubricDims = question.rubric.dimensions.map(dim => ({
                    name: dim.name,
                    text: dim.description,
                    weight: dim.weight
                }));
            } else {
                referenceAnswer = question.referenceAnswer;
            }
            
            // Call ML service
            const gradingResult = await mlService.withRetry(() => 
                mlService.grade({
                    questionId: questionId,
                    studentId: req.userId.toString(),
                    answerText: answerText,
                    rubricDims: rubricDims,
                    referenceAnswer: referenceAnswer,
                    computeExplanations: true
                })
            );
            
            // Update submission with results
            submission.updateWithGradingResults(gradingResult);
            submission.scaledOverallScore = submission.overallScore * question.maxScore;
            
        } catch (mlError) {
            console.error('ML service error:', mlError);
            submission.status = 'error';
            submission.gradingMetadata = {
                error: mlError.message,
                gradedAt: new Date()
            };
        }
        
        await submission.save();
        await submission.populate('question', 'title maxScore');
        
        res.status(201).json({
            success: true,
            message: submission.status === 'graded' ? 'Answer graded successfully' : 'Grading in progress',
            data: submission
        });
    } catch (error) {
        console.error('Submit answer error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to submit answer'
        });
    }
};

/**
 * Get submission by ID
 * GET /api/grading/submissions/:id
 */
const getSubmission = async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id)
            .populate('question', 'title content maxScore')
            .populate('student', 'name email studentId');
        
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }
        
        // Check access
        const isOwner = submission.student._id.toString() === req.userId.toString();
        const isTeacher = req.user.role === 'teacher';
        
        if (!isOwner && !isTeacher) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view this submission'
            });
        }
        
        res.json({
            success: true,
            data: submission
        });
    } catch (error) {
        console.error('Get submission error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get submission'
        });
    }
};

/**
 * Get all submissions for a student
 * GET /api/grading/my-submissions
 */
const getMySubmissions = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        
        const query = { student: req.userId };
        if (status) query.status = status;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [submissions, total] = await Promise.all([
            Submission.find(query)
                .populate('question', 'title maxScore subject')
                .sort({ submittedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Submission.countDocuments(query)
        ]);
        
        res.json({
            success: true,
            data: submissions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get my submissions error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get submissions'
        });
    }
};

/**
 * Get all submissions for a question (teacher only)
 * GET /api/grading/questions/:questionId/submissions
 */
const getQuestionSubmissions = async (req, res) => {
    try {
        const question = await Question.findById(req.params.questionId);
        
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        // Check ownership
        if (question.createdBy.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view submissions for this question'
            });
        }
        
        const { status, page = 1, limit = 50 } = req.query;
        
        const query = { question: req.params.questionId };
        if (status) query.status = status;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [submissions, total] = await Promise.all([
            Submission.find(query)
                .populate('student', 'name email studentId')
                .sort({ submittedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Submission.countDocuments(query)
        ]);
        
        res.json({
            success: true,
            data: submissions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get question submissions error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to get submissions'
        });
    }
};

/**
 * Override submission score (teacher only)
 * PUT /api/grading/submissions/:id/override
 */
const overrideScore = async (req, res) => {
    try {
        const { newScore, reason } = req.body;
        
        const submission = await Submission.findById(req.params.id)
            .populate('question');
        
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }
        
        // Check teacher owns the question
        if (submission.question.createdBy.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to override this submission'
            });
        }
        
        // Store override
        submission.manualOverride = {
            overriddenBy: req.userId,
            overriddenAt: new Date(),
            originalScore: submission.overallScore,
            reason: reason || 'Manual review'
        };
        
        submission.overallScore = newScore;
        submission.scaledOverallScore = newScore * submission.question.maxScore;
        submission.status = 'manual_review';
        
        await submission.save();
        
        res.json({
            success: true,
            message: 'Score overridden successfully',
            data: submission
        });
    } catch (error) {
        console.error('Override score error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to override score'
        });
    }
};

/**
 * Re-grade a submission
 * POST /api/grading/submissions/:id/regrade
 */
const regradeSubmission = async (req, res) => {
    try {
        const submission = await Submission.findById(req.params.id)
            .populate({
                path: 'question',
                populate: { path: 'rubric' }
            });
        
        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }
        
        // Check ownership (student can regrade own, teacher can regrade any in their questions)
        const isOwner = submission.student.toString() === req.userId.toString();
        const isTeacher = req.user.role === 'teacher' && 
            submission.question.createdBy.toString() === req.userId.toString();
        
        if (!isOwner && !isTeacher) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to regrade this submission'
            });
        }
        
        // Trigger re-grading
        submission.status = 'grading';
        await submission.save();
        
        try {
            let rubricDims = null;
            let referenceAnswer = null;
            
            if (submission.question.rubric && submission.question.rubric.dimensions.length > 0) {
                rubricDims = submission.question.rubric.dimensions.map(dim => ({
                    name: dim.name,
                    text: dim.description,
                    weight: dim.weight
                }));
            } else {
                referenceAnswer = submission.question.referenceAnswer;
            }
            
            const gradingResult = await mlService.withRetry(() =>
                mlService.grade({
                    questionId: submission.question._id.toString(),
                    studentId: submission.student.toString(),
                    answerText: submission.answerText,
                    rubricDims: rubricDims,
                    referenceAnswer: referenceAnswer,
                    computeExplanations: true
                })
            );
            
            submission.updateWithGradingResults(gradingResult);
            submission.scaledOverallScore = submission.overallScore * submission.question.maxScore;
            
        } catch (mlError) {
            console.error('ML service error during regrade:', mlError);
            submission.status = 'error';
        }
        
        await submission.save();
        
        res.json({
            success: true,
            message: 'Submission regraded successfully',
            data: submission
        });
    } catch (error) {
        console.error('Regrade submission error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to regrade submission'
        });
    }
};

/**
 * Check ML service health
 * GET /api/grading/health
 */
const checkMLHealth = async (req, res) => {
    try {
        const health = await mlService.checkHealth();
        
        res.json({
            success: true,
            data: health
        });
    } catch (error) {
        res.json({
            success: false,
            data: {
                healthy: false,
                error: error.message
            }
        });
    }
};

module.exports = {
    submitAnswer,
    getSubmission,
    getMySubmissions,
    getQuestionSubmissions,
    overrideScore,
    regradeSubmission,
    checkMLHealth
};