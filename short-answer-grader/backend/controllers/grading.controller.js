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

        console.log('Submitting answer for question:', questionId);

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

        // Optional: Validate answer quality using ML service (non-blocking)
        let validationWarnings = [];
        try {
            const mlHealth = await mlService.checkHealth();
            if (mlHealth.healthy) {
                const validation = await mlService.validateAnswer(answerText);
                if (!validation.valid) {
                    validationWarnings = validation.issues || [];
                    console.log('Validation warnings:', validationWarnings);
                }
            }
        } catch (validationError) {
            console.warn('Answer validation skipped:', validationError.message);
        }

        if (submission) {
            // Update existing submission
            submission.answerText = answerText;
            submission.attempts += 1;
            submission.status = 'pending';
            submission.submittedAt = new Date();
            // Clear previous grading results
            submission.overallScore = undefined;
            submission.scaledOverallScore = undefined;
            submission.dimensionScores = [];
            submission.feedback = [];
            submission.gradingMetadata = {};
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
        console.log('Submission saved with status:', submission.status);

        // Trigger grading
        submission.status = 'grading';
        await submission.save();

        try {
            // Check ML service health first
            const mlHealth = await mlService.checkHealth();
            
            if (!mlHealth.healthy) {
                throw new Error('ML service is not available');
            }

            // Prepare rubric dimensions
            let rubricDims = null;
            let referenceAnswer = null;

            if (question.rubric && question.rubric.dimensions && question.rubric.dimensions.length > 0) {
                rubricDims = question.rubric.dimensions.map(dim => ({
                    name: dim.name,
                    text: dim.description,
                    weight: dim.weight || 1.0
                }));
                console.log('Using rubric dimensions:', rubricDims.length);
            } else {
                referenceAnswer = question.referenceAnswer;
                console.log('Using reference answer for grading');
            }

            // Call ML service
            console.log('Calling ML service for grading...');
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

            console.log('Grading result received:', {
                overall_score: gradingResult.overall_score,
                dimensions: Object.keys(gradingResult.per_dimension || {}).length
            });

            // Update submission with results
            submission.overallScore = gradingResult.overall_score;
            submission.scaledOverallScore = gradingResult.overall_score * question.maxScore;
            submission.status = 'graded';
            
            // Map dimension scores
            if (gradingResult.per_dimension) {
                submission.dimensionScores = Object.entries(gradingResult.per_dimension).map(([name, data]) => ({
                    dimensionName: name,
                    score: data.score,
                    scaledScore: data.score * question.maxScore,
                    confidence: data.confidence,
                    highlights: data.highlights || [],
                    feedback: ''
                }));
            }
            
            // Set feedback
            submission.feedback = gradingResult.feedback || [];
            
            // Set metadata
            submission.gradingMetadata = {
                model: gradingResult.metadata?.model || 'unknown',
                modelVersion: gradingResult.metadata?.model_version || 'v1.0',
                timeMs: gradingResult.metadata?.time_ms,
                gradedAt: new Date()
            };

        } catch (mlError) {
            console.error('ML service error:', mlError.message);
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
            message: submission.status === 'graded' 
                ? 'Answer graded successfully' 
                : submission.status === 'error' 
                    ? 'Grading failed - please try again later'
                    : 'Grading in progress',
            data: {
                ...submission.toObject(),
                validationWarnings
            }
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
            .populate('question', 'title content maxScore referenceAnswer')
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

        // Format response with grading result structure expected by frontend
        const response = {
            _id: submission._id,
            student: submission.student,
            question: submission.question,
            answerText: submission.answerText,
            status: submission.status,
            attempts: submission.attempts,
            submittedAt: submission.submittedAt,
            overallScore: submission.overallScore,
            scaledOverallScore: submission.scaledOverallScore,
            totalScore: submission.scaledOverallScore,
            canOverride: isTeacher,
            manualOverride: submission.manualOverride,
            gradingResult: {
                overall_score: submission.overallScore,
                per_dimension: {},
                feedback: submission.feedback || [],
                metadata: submission.gradingMetadata || {}
            }
        };

        // Map dimension scores to expected format
        if (submission.dimensionScores && submission.dimensionScores.length > 0) {
            submission.dimensionScores.forEach(dim => {
                response.gradingResult.per_dimension[dim.dimensionName] = {
                    score: dim.score,
                    confidence: dim.confidence,
                    highlights: dim.highlights || []
                };
            });
        }

        res.json({
            success: true,
            data: response
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
        if (status) {
            query.status = status;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [submissions, total] = await Promise.all([
            Submission.find(query)
                .populate('question', 'title maxScore subject topic')
                .sort({ submittedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Submission.countDocuments(query)
        ]);

        // Format submissions with totalScore for frontend
        const formattedSubmissions = submissions.map(sub => ({
            ...sub.toObject(),
            totalScore: sub.scaledOverallScore
        }));

        res.json({
            success: true,
            data: formattedSubmissions,
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
        const { questionId } = req.params;
        const { status, page = 1, limit = 50 } = req.query;

        // Verify question ownership
        const question = await Question.findById(questionId);
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }

        if (question.createdBy.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view submissions for this question'
            });
        }

        const query = { question: questionId };
        if (status) {
            query.status = status;
        }

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
        const { score, reason } = req.body;

        if (score === undefined || score < 0 || score > 1) {
            return res.status(400).json({
                success: false,
                message: 'Score must be between 0 and 1'
            });
        }

        const submission = await Submission.findById(req.params.id)
            .populate('question');

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        // Verify question ownership
        if (submission.question.createdBy.toString() !== req.userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to override this submission'
            });
        }

        // Store override information
        submission.manualOverride = {
            overriddenBy: req.userId,
            overriddenAt: new Date(),
            originalScore: submission.overallScore,
            reason: reason || 'Manual score override'
        };

        submission.overallScore = score;
        submission.scaledOverallScore = score * submission.question.maxScore;
        submission.status = 'graded';

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

        // Check ML service health
        const mlHealth = await mlService.checkHealth();
        if (!mlHealth.healthy) {
            return res.status(503).json({
                success: false,
                message: 'ML service is not available'
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

            // Update submission
            submission.overallScore = gradingResult.overall_score;
            submission.scaledOverallScore = gradingResult.overall_score * submission.question.maxScore;
            submission.status = 'graded';
            
            if (gradingResult.per_dimension) {
                submission.dimensionScores = Object.entries(gradingResult.per_dimension).map(([name, data]) => ({
                    dimensionName: name,
                    score: data.score,
                    scaledScore: data.score * submission.question.maxScore,
                    confidence: data.confidence,
                    highlights: data.highlights || []
                }));
            }
            
            submission.feedback = gradingResult.feedback || [];
            submission.gradingMetadata = {
                model: gradingResult.metadata?.model,
                modelVersion: gradingResult.metadata?.model_version,
                timeMs: gradingResult.metadata?.time_ms,
                gradedAt: new Date(),
                regraded: true
            };

        } catch (mlError) {
            console.error('Regrade ML error:', mlError);
            submission.status = 'error';
            submission.gradingMetadata = {
                error: mlError.message,
                gradedAt: new Date()
            };
        }

        await submission.save();

        res.json({
            success: true,
            message: submission.status === 'graded' ? 'Regrading completed' : 'Regrading failed',
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
            success: true,
            data: {
                healthy: false,
                error: error.message
            }
        });
    }
};

/**
 * Batch grade multiple submissions
 * POST /api/grading/batch-grade
 */
const batchGrade = async (req, res) => {
    try {
        const { submissionIds } = req.body;

        if (!submissionIds || !Array.isArray(submissionIds) || submissionIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'submissionIds array is required'
            });
        }

        // Check ML service health
        const mlHealth = await mlService.checkHealth();
        if (!mlHealth.healthy) {
            return res.status(503).json({
                success: false,
                message: 'ML service is not available'
            });
        }

        // Fetch all submissions
        const submissions = await Submission.find({
            _id: { $in: submissionIds }
        }).populate({
            path: 'question',
            populate: { path: 'rubric' }
        });

        if (submissions.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No submissions found'
            });
        }

        // Group by question for batch processing
        const byQuestion = {};
        submissions.forEach(sub => {
            const qId = sub.question._id.toString();
            if (!byQuestion[qId]) {
                byQuestion[qId] = {
                    question: sub.question,
                    submissions: []
                };
            }
            byQuestion[qId].submissions.push(sub);
        });

        const results = [];

        // Process each question group
        for (const qId in byQuestion) {
            const { question, submissions: qSubmissions } = byQuestion[qId];

            // Prepare rubric dimensions
            let rubricDims = null;

            if (question.rubric && question.rubric.dimensions && question.rubric.dimensions.length > 0) {
                rubricDims = question.rubric.dimensions.map(dim => ({
                    name: dim.name,
                    text: dim.description,
                    weight: dim.weight
                }));
            }

            if (!rubricDims) {
                // Grade individually with reference answer
                for (const submission of qSubmissions) {
                    try {
                        const gradingResult = await mlService.withRetry(() =>
                            mlService.grade({
                                questionId: qId,
                                studentId: submission.student.toString(),
                                answerText: submission.answerText,
                                referenceAnswer: question.referenceAnswer,
                                computeExplanations: true
                            })
                        );

                        submission.overallScore = gradingResult.overall_score;
                        submission.scaledOverallScore = gradingResult.overall_score * question.maxScore;
                        submission.status = 'graded';
                        submission.gradingMetadata = {
                            model: gradingResult.metadata?.model,
                            gradedAt: new Date()
                        };
                        await submission.save();

                        results.push({
                            submissionId: submission._id,
                            status: 'graded',
                            score: submission.overallScore
                        });
                    } catch (err) {
                        submission.status = 'error';
                        await submission.save();
                        results.push({
                            submissionId: submission._id,
                            status: 'error',
                            error: err.message
                        });
                    }
                }
                continue;
            }

            // Batch grade all submissions for this question
            const answers = qSubmissions.map(sub => sub.answerText);

            try {
                const batchResults = await mlService.withRetry(() =>
                    mlService.batchGrade(answers, rubricDims)
                );

                // Update submissions with results
                for (let i = 0; i < qSubmissions.length; i++) {
                    const submission = qSubmissions[i];
                    const result = batchResults.results[i];

                    submission.overallScore = result.overall_score;
                    submission.scaledOverallScore = result.overall_score * question.maxScore;
                    submission.status = 'graded';
                    
                    if (result.per_dimension) {
                        submission.dimensionScores = Object.entries(result.per_dimension).map(([name, data]) => ({
                            dimensionName: name,
                            score: data.score,
                            confidence: data.confidence,
                            highlights: data.highlights || []
                        }));
                    }
                    
                    submission.gradingMetadata = {
                        model: result.metadata?.model,
                        gradedAt: new Date(),
                        batchGraded: true
                    };
                    
                    await submission.save();

                    results.push({
                        submissionId: submission._id,
                        status: 'graded',
                        score: submission.overallScore
                    });
                }
            } catch (mlError) {
                console.error('Batch grading error for question', qId, mlError);

                // Mark submissions as error
                for (const submission of qSubmissions) {
                    submission.status = 'error';
                    await submission.save();

                    results.push({
                        submissionId: submission._id,
                        status: 'error',
                        error: mlError.message
                    });
                }
            }
        }

        res.json({
            success: true,
            message: `Batch graded ${results.length} submissions`,
            data: results
        });
    } catch (error) {
        console.error('Batch grade error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to batch grade'
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
    batchGrade,
    checkMLHealth
};